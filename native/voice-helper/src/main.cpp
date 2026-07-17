#include <cstdlib>
#include <iostream>
#include <optional>
#include <string>

namespace {

constexpr int kProtocolVersion = 1;

std::optional<std::string> json_string(const std::string& line,
                                       const std::string& key) {
  const std::string prefix = "\"" + key + "\":\"";
  const std::size_t start = line.find(prefix);
  if (start == std::string::npos) {
    return std::nullopt;
  }
  const std::size_t value_start = start + prefix.size();
  const std::size_t end = line.find('"', value_start);
  if (end == std::string::npos) {
    return std::nullopt;
  }
  return line.substr(value_start, end - value_start);
}

std::string escape_json(const std::string& value) {
  std::string escaped;
  escaped.reserve(value.size());
  for (const char character : value) {
    if (character == '\\' || character == '"') {
      escaped.push_back('\\');
    }
    escaped.push_back(character);
  }
  return escaped;
}

void emit(const std::string& json) {
  std::cout << json << '\n' << std::flush;
}

int run_stdio() {
  std::string active_session;
  std::string line;
  while (std::getline(std::cin, line)) {
    const std::optional<std::string> type = json_string(line, "type");
    if (!type.has_value()) {
      emit(R"({"type":"error","code":"invalid_command","message":"Command type is missing."})");
      continue;
    }

    if (*type == "hello") {
      emit(R"({"type":"hello","protocolVersion":1,"helperVersion":"0.1.0-stub"})");
    } else if (*type == "start") {
      active_session = json_string(line, "sessionId").value_or("");
      emit("{\"type\":\"recording\",\"sessionId\":\"" +
           escape_json(active_session) + "\"}");
    } else if (*type == "stop") {
      const char* transcript = std::getenv("COPILOT_SPEECH_STUB_TRANSCRIPT");
      if (transcript != nullptr && transcript[0] != '\0') {
        emit("{\"type\":\"final\",\"sessionId\":\"" +
             escape_json(active_session) +
             "\",\"text\":\"" +
             escape_json(transcript) + "\"}");
      } else {
        emit("{\"type\":\"error\",\"code\":\"runtime_not_implemented\",\"message\":\"This first draft contains the protocol stub, not microphone capture or Moonshine inference.\",\"sessionId\":\"" +
             escape_json(active_session) + "\"}");
      }
      active_session.clear();
    } else if (*type == "cancel") {
      emit("{\"type\":\"cancelled\",\"sessionId\":\"" +
           escape_json(active_session) + "\"}");
      active_session.clear();
    } else {
      emit(R"({"type":"error","code":"unsupported_command","message":"The protocol stub does not support this command."})");
    }
  }
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--version") {
    std::cout << "copilot-speech-helper 0.1.0-stub\n";
    return 0;
  }
  if (argc == 2 && std::string(argv[1]) == "--stdio") {
    return run_stdio();
  }
  std::cerr << "usage: copilot-speech-helper --version|--stdio\n";
  return 2;
}