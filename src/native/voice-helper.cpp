#include <nlohmann/json.hpp>

#ifdef _WIN32
# ifndef WIN32_LEAN_AND_MEAN
#  define WIN32_LEAN_AND_MEAN
# endif
# ifndef NOMINMAX
#  define NOMINMAX
# endif
#endif

#define MINIAUDIO_IMPLEMENTATION
#include <miniaudio.h>

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

using Json = nlohmann::json;

constexpr int kProtocolVersion = 3;
constexpr int kSampleRate = 16000;
constexpr ma_uint32 kMaxQueuedFrames = kSampleRate * 5;
constexpr ma_uint32 kReadFrames = 1600;

enum class SessionRequest { none, stop, cancel };

const char kBase64Alphabet[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string base64_encode(const uint8_t* data, size_t length) {
  std::string out;
  out.reserve(((length + 2) / 3) * 4);
  size_t i = 0;
  for (; i + 2 < length; i += 3) {
    const uint32_t triple =
        (static_cast<uint32_t>(data[i]) << 16) |
        (static_cast<uint32_t>(data[i + 1]) << 8) |
        static_cast<uint32_t>(data[i + 2]);
    out.push_back(kBase64Alphabet[(triple >> 18) & 0x3F]);
    out.push_back(kBase64Alphabet[(triple >> 12) & 0x3F]);
    out.push_back(kBase64Alphabet[(triple >> 6) & 0x3F]);
    out.push_back(kBase64Alphabet[triple & 0x3F]);
  }
  if (i < length) {
    uint32_t triple = static_cast<uint32_t>(data[i]) << 16;
    const bool has_two = (i + 1) < length;
    if (has_two) {
      triple |= static_cast<uint32_t>(data[i + 1]) << 8;
    }
    out.push_back(kBase64Alphabet[(triple >> 18) & 0x3F]);
    out.push_back(kBase64Alphabet[(triple >> 12) & 0x3F]);
    out.push_back(has_two ? kBase64Alphabet[(triple >> 6) & 0x3F] : '=');
    out.push_back('=');
  }
  return out;
}

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

void emit_pcm(const std::string& session_id, const float* samples,
              size_t frame_count) {
  if (frame_count == 0) {
    return;
  }
  std::vector<uint8_t> bytes(frame_count * 2);
  for (size_t i = 0; i < frame_count; ++i) {
    float clamped = samples[i];
    if (clamped > 1.0f) {
      clamped = 1.0f;
    } else if (clamped < -1.0f) {
      clamped = -1.0f;
    }
    const int32_t scaled =
        static_cast<int32_t>(clamped * 32767.0f + (clamped >= 0 ? 0.5f : -0.5f));
    const int16_t value = static_cast<int16_t>(scaled);
    bytes[i * 2] = static_cast<uint8_t>(value & 0xFF);
    bytes[i * 2 + 1] = static_cast<uint8_t>((value >> 8) & 0xFF);
  }
  emit({{"type", "pcm"},
        {"sessionId", session_id},
        {"data", base64_encode(bytes.data(), bytes.size())}});
}

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
        start(required_string(command, "sessionId"));
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

  void start(const std::string& session_id) {
    if (session_id.empty()) {
      emit_error("invalid_command", "Start requires sessionId.", session_id);
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
    worker_ = std::thread(&Helper::run_session, this, session_id);
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

  void run_session(const std::string& session_id) {
    const char* stub = std::getenv("COPILOT_SPEECH_STUB_TRANSCRIPT");
    if (stub != nullptr) {
      run_stub_session(session_id);
      finish_session(session_id);
      return;
    }

    ma_device device{};
    bool device_initialized = false;
    bool device_started = false;
    auto capture = std::make_shared<CaptureContext>();

    try {
      if (request_.load() == SessionRequest::cancel) {
        emit({{"type", "stopped"}, {"sessionId", session_id}});
        finish_session(session_id);
        return;
      }

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
        emit({{"type", "stopped"}, {"sessionId", session_id}});
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
          emit_pcm(session_id, chunk.data(), readable);
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

      emit({{"type", "stopped"}, {"sessionId", session_id}});
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

  void run_stub_session(const std::string& session_id) {
    emit({{"type", "recording"}, {"sessionId", session_id}});
    {
      std::unique_lock lock(state_mutex_);
      request_changed_.wait(
          lock, [this] { return request_.load() != SessionRequest::none; });
    }
    emit({{"type", "stopped"}, {"sessionId", session_id}});
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

}

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
