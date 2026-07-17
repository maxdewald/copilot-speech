cmake_minimum_required(VERSION 3.20)
project(copilot_speech_helper VERSION 0.1.0 LANGUAGES CXX)

add_executable(copilot-speech-helper src/main.cpp)
target_compile_features(copilot-speech-helper PRIVATE cxx_std_20)

if(MSVC)
  target_compile_options(copilot-speech-helper PRIVATE /W4 /WX /utf-8)
else()
  target_compile_options(copilot-speech-helper PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

enable_testing()
add_test(
  NAME helper-protocol
  COMMAND ${CMAKE_COMMAND}
    -DHELPER=$<TARGET_FILE:copilot-speech-helper>
    -P ${CMAKE_CURRENT_SOURCE_DIR}/test/protocol.cmake
)