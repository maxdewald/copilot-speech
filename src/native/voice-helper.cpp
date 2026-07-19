#define MINIAUDIO_IMPLEMENTATION
#include <miniaudio.h>
#include <moonshine-cpp.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <cstring>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {

using Json = nlohmann::json;

constexpr int kProtocolVersion = 1;
constexpr int kSampleRate = 16000;
constexpr ma_uint32 kMaxQueuedFrames = kSampleRate * 5;
constexpr ma_uint32 kReadFrames = 4096;

enum class SessionRequest { none, stop, cancel };

void emit(const Json& event) {
  static std::mutex output_mutex;
  const std::lock_guard lock(output_mutex);
  std::cout << event.dump() << '\n' << std::flush;
}

void emit_error(const std::string& code, const std::string& message,
                const std::string& session_id = "") {
  Json event = {{"type", "error"}, {"code", code}, {"message", message}};
  if (!session_id.empty()) {
    event["sessionId"] = session_id;
  }
  emit(event);
}

std::string required_string(const Json& command, const char* key) {
  if (!command.contains(key) || !command.at(key).is_string()) {
    throw std::invalid_argument(std::string("Command field \"") + key +
                                "\" must be a string.");
  }
  return command.at(key).get<std::string>();
}

std::string transcript_text(
    const std::vector<std::pair<uint64_t, std::string>>& lines) {
  std::string text;
  for (const auto& [_, line] : lines) {
    if (line.empty()) {
      continue;
    }
    if (!text.empty()) {
      text.push_back(' ');
    }
    text += line;
  }
  return text;
}

class TranscriptListener final : public moonshine::TranscriptEventListener {
 public:
  TranscriptListener(std::string session_id,
                     const std::atomic<SessionRequest>& request)
      : session_id_(std::move(session_id)), request_(request) {}

  void onLineStarted(const moonshine::LineStarted& event) override {
    update(event.line);
  }

  void onLineTextChanged(
      const moonshine::LineTextChanged& event) override {
    update(event.line);
  }

  void onLineCompleted(const moonshine::LineCompleted& event) override {
    update(event.line);
  }

  void onError(const moonshine::Error& event) override {
    error_ = event.errorMessage;
  }

  std::string text() const { return transcript_text(lines_); }

  const std::optional<std::string>& error() const { return error_; }

 private:
  std::string session_id_;
  const std::atomic<SessionRequest>& request_;
  std::vector<std::pair<uint64_t, std::string>> lines_;
  std::string last_text_;
  std::optional<std::string> error_;

  void update(const moonshine::TranscriptLine& line) {
    const auto existing = std::find_if(
        lines_.begin(), lines_.end(),
        [&line](const auto& value) { return value.first == line.lineId; });
    if (existing == lines_.end()) {
      lines_.emplace_back(line.lineId, line.text);
    } else {
      existing->second = line.text;
    }
    const std::string text = transcript_text(lines_);
    if (text == last_text_) {
      return;
    }
    last_text_ = text;
    if (request_.load() != SessionRequest::none) {
      return;
    }
    emit({{"type", "partial"},
          {"sessionId", session_id_},
          {"text", text}});
  }
};

class Helper {
 public:
  ~Helper() {
    request(SessionRequest::cancel, "");
    join_worker();
  }

  int run() {
    std::string line;
    while (std::getline(std::cin, line)) {
      reap_worker();
      handle_command(line);
    }
    request(SessionRequest::cancel, "");
    join_worker();
    return 0;
  }

 private:
  struct CaptureContext {
    ma_pcm_rb ring{};
    std::atomic<uint64_t> changed{0};
    std::atomic<bool> accepting{true};
    std::atomic<bool> expected_stop{false};
    std::atomic<bool> device_stopped{false};
    std::atomic<bool> overflowed{false};

    CaptureContext() {
      if (ma_pcm_rb_init(ma_format_f32, 1, kMaxQueuedFrames, nullptr, nullptr,
                         &ring) != MA_SUCCESS) {
        throw std::runtime_error("Failed to initialize the audio buffer.");
      }
    }

    ~CaptureContext() { ma_pcm_rb_uninit(&ring); }

    void notify() {
      changed.fetch_add(1, std::memory_order_release);
      changed.notify_one();
    }
  };

  std::mutex state_mutex_;
  std::condition_variable request_changed_;
  std::atomic<SessionRequest> request_{SessionRequest::none};
  std::string active_session_;
  std::shared_ptr<CaptureContext> capture_;
  std::thread worker_;

  static void capture_callback(ma_device* device, void*, const void* input,
                               ma_uint32 frame_count) {
    auto* capture = static_cast<CaptureContext*>(device->pUserData);
    if (capture == nullptr || input == nullptr ||
        !capture->accepting.load(std::memory_order_relaxed)) {
      return;
    }

    const auto* samples = static_cast<const float*>(input);
    ma_uint32 remaining = frame_count;
    while (remaining > 0) {
      ma_uint32 writable = remaining;
      void* output = nullptr;
      if (ma_pcm_rb_acquire_write(&capture->ring, &writable, &output) !=
              MA_SUCCESS ||
          writable == 0) {
        capture->overflowed = true;
        break;
      }
      std::memcpy(output, samples + (frame_count - remaining),
                  writable * sizeof(float));
      if (ma_pcm_rb_commit_write(&capture->ring, writable) != MA_SUCCESS) {
        capture->overflowed = true;
        break;
      }
      remaining -= writable;
    }
    capture->notify();
  }

  static void notification_callback(
      const ma_device_notification* notification) {
    if (notification == nullptr || notification->pDevice == nullptr ||
        notification->type != ma_device_notification_type_stopped) {
      return;
    }
    auto* capture =
        static_cast<CaptureContext*>(notification->pDevice->pUserData);
    if (capture != nullptr && !capture->expected_stop.load()) {
      capture->device_stopped = true;
      capture->notify();
    }
  }

  void handle_command(const std::string& line) {
    try {
      const Json command = Json::parse(line);
      if (!command.is_object()) {
        throw std::invalid_argument("Command must be a JSON object.");
      }

      const std::string type = required_string(command, "type");
      if (type == "hello") {
        emit({{"type", "hello"},
              {"protocolVersion", kProtocolVersion},
              {"helperVersion", "0.1.0"}});
      } else if (type == "start") {
        start(required_string(command, "sessionId"),
              required_string(command, "modelPath"));
      } else if (type == "stop") {
        request(SessionRequest::stop,
                required_string(command, "sessionId"));
      } else if (type == "cancel") {
        request(SessionRequest::cancel,
                required_string(command, "sessionId"));
      } else {
        emit_error("unsupported_command",
                   "The native helper does not support this command.");
      }
    } catch (const std::exception& error) {
      emit_error("invalid_command", error.what());
    }
  }

  void start(const std::string& session_id, const std::string& model_path) {
    const char* stub = std::getenv("COPILOT_SPEECH_STUB_TRANSCRIPT");
    if (session_id.empty() || (model_path.empty() && stub == nullptr)) {
      emit_error("invalid_command", "Start requires sessionId and modelPath.",
                 session_id);
      return;
    }

    {
      const std::lock_guard lock(state_mutex_);
      if (!active_session_.empty()) {
        emit_error("session_active", "A dictation session is already active.",
                   session_id);
        return;
      }
      active_session_ = session_id;
      request_.store(SessionRequest::none);
    }

    join_worker();
    worker_ = std::thread(&Helper::run_session, this, session_id, model_path);
  }

  void request(SessionRequest value, const std::string& session_id) {
    std::shared_ptr<CaptureContext> capture;
    {
      const std::lock_guard lock(state_mutex_);
      if (active_session_.empty() ||
          (!session_id.empty() && session_id != active_session_)) {
        return;
      }
      if (value == SessionRequest::cancel) {
        request_.store(value);
      } else {
        SessionRequest expected = SessionRequest::none;
        request_.compare_exchange_strong(expected, value);
      }
      capture = capture_;
    }
    request_changed_.notify_all();
    if (capture) {
      capture->notify();
    }
  }

  void run_session(const std::string& session_id,
                   const std::string& model_path) {
    const char* stub = std::getenv("COPILOT_SPEECH_STUB_TRANSCRIPT");
    if (stub != nullptr) {
      run_stub_session(session_id, stub);
      finish_session(session_id);
      return;
    }

    ma_device device{};
    bool device_initialized = false;
    bool device_started = false;
    auto capture = std::make_shared<CaptureContext>();

    try {
      moonshine::Transcriber transcriber(
          model_path, moonshine::ModelArch::MEDIUM_STREAMING, 0.5);
      if (request_.load() == SessionRequest::cancel) {
        emit({{"type", "cancelled"}, {"sessionId", session_id}});
        finish_session(session_id);
        return;
      }
      TranscriptListener listener(session_id, request_);
      transcriber.addListener(&listener);
      transcriber.start();

      {
        const std::lock_guard lock(state_mutex_);
        capture_ = capture;
      }

      ma_device_config config = ma_device_config_init(ma_device_type_capture);
      config.capture.format = ma_format_f32;
      config.capture.channels = 1;
      config.sampleRate = kSampleRate;
      config.dataCallback = capture_callback;
      config.notificationCallback = notification_callback;
      config.pUserData = capture.get();
      if (ma_device_init(nullptr, &config, &device) != MA_SUCCESS) {
        throw std::runtime_error("Failed to initialize the default microphone.");
      }
      device_initialized = true;
      if (request_.load() == SessionRequest::cancel) {
        capture->expected_stop = true;
        ma_device_uninit(&device);
        device_initialized = false;
        clear_capture(capture);
        emit({{"type", "cancelled"}, {"sessionId", session_id}});
        finish_session(session_id);
        return;
      }
      if (ma_device_start(&device) != MA_SUCCESS) {
        throw std::runtime_error("Failed to start microphone capture.");
      }
      device_started = true;

      emit({{"type", "recording"}, {"sessionId", session_id}});

      bool capture_stopped = false;
      std::vector<float> chunk(kReadFrames);
      while (true) {
        const uint64_t observed = capture->changed.load();
        const SessionRequest requested = request_.load();
        if (requested != SessionRequest::none && !capture_stopped) {
          capture->accepting = false;
          capture->expected_stop = true;
          if (device_started) {
            ma_device_stop(&device);
            device_started = false;
          }
          capture_stopped = true;
        }

        if (capture->overflowed.load()) {
          throw std::runtime_error(
              "Audio processing fell behind microphone capture.");
        }
        if (capture->device_stopped.load()) {
          throw std::runtime_error("The microphone stopped unexpectedly.");
        }

        ma_uint32 readable = kReadFrames;
        void* input = nullptr;
        if (ma_pcm_rb_acquire_read(&capture->ring, &readable, &input) !=
            MA_SUCCESS) {
          throw std::runtime_error("Failed to read captured audio.");
        }
        if (readable > 0) {
          std::memcpy(chunk.data(), input, readable * sizeof(float));
          if (ma_pcm_rb_commit_read(&capture->ring, readable) != MA_SUCCESS) {
            throw std::runtime_error("Failed to release captured audio.");
          }
        }

        const SessionRequest current = request_.load();
        if (current == SessionRequest::cancel) {
          break;
        }
        if (readable > 0) {
          chunk.resize(readable);
          transcriber.addAudio(chunk, kSampleRate);
          chunk.resize(kReadFrames);
          if (listener.error()) {
            throw std::runtime_error(*listener.error());
          }
          continue;
        }
        if (current == SessionRequest::stop) {
          break;
        }
        capture->changed.wait(observed);
      }

      if (device_started) {
        capture->expected_stop = true;
        ma_device_stop(&device);
        device_started = false;
      }
      ma_device_uninit(&device);
      device_initialized = false;
      clear_capture(capture);

      if (request_.load() == SessionRequest::cancel) {
        emit({{"type", "cancelled"}, {"sessionId", session_id}});
      } else {
        transcriber.stop();
        if (listener.error()) {
          throw std::runtime_error(*listener.error());
        }
        emit({{"type", "final"},
              {"sessionId", session_id},
              {"text", listener.text()}});
      }
    } catch (const std::exception& error) {
      if (device_started) {
        capture->expected_stop = true;
        ma_device_stop(&device);
      }
      if (device_initialized) {
        ma_device_uninit(&device);
      }
      clear_capture(capture);
      emit_error("runtime_error", error.what(), session_id);
    }

    finish_session(session_id);
  }

  void run_stub_session(const std::string& session_id,
                        const std::string& transcript) {
    emit({{"type", "recording"}, {"sessionId", session_id}});
    {
      std::unique_lock lock(state_mutex_);
      request_changed_.wait(
          lock, [this] { return request_.load() != SessionRequest::none; });
    }
    if (request_.load() == SessionRequest::cancel) {
      emit({{"type", "cancelled"}, {"sessionId", session_id}});
    } else {
      emit({{"type", "final"},
            {"sessionId", session_id},
            {"text", transcript}});
    }
  }

  void clear_capture(const std::shared_ptr<CaptureContext>& capture) {
    const std::lock_guard lock(state_mutex_);
    if (capture_ == capture) {
      capture_.reset();
    }
  }

  void finish_session(const std::string& session_id) {
    const std::lock_guard lock(state_mutex_);
    if (active_session_ == session_id) {
      active_session_.clear();
      request_.store(SessionRequest::none);
      capture_.reset();
    }
  }

  void reap_worker() {
    bool finished = false;
    {
      const std::lock_guard lock(state_mutex_);
      finished = active_session_.empty();
    }
    if (finished) {
      join_worker();
    }
  }

  void join_worker() {
    if (worker_.joinable()) {
      worker_.join();
    }
  }
};

}  // namespace

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--version") {
    std::cout << "copilot-speech-helper 0.1.0\n";
    return 0;
  }
  if (argc == 2 && std::string(argv[1]) == "--stdio") {
    return Helper().run();
  }
  std::cerr << "usage: copilot-speech-helper --version|--stdio\n";
  return 2;
}