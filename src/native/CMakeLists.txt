cmake_minimum_required(VERSION 3.20)
project(copilot_speech_helper VERSION 0.1.0 LANGUAGES CXX)

if(POLICY CMP0135)
  cmake_policy(SET CMP0135 NEW)
endif()

if(NOT DEFINED COPILOT_SPEECH_RUNTIME_TARGET)
  message(FATAL_ERROR "COPILOT_SPEECH_RUNTIME_TARGET is required. Run: pnpm native:configure")
endif()

include(FetchContent)

FetchContent_Declare(
  nlohmann_json
  URL https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz
  URL_HASH SHA256=42f6e95cad6ec532fd372391373363b62a14af6d771056dbfc86160e6dfff7aa
)
set(JSON_BuildTests OFF CACHE INTERNAL "")
set(JSON_Install OFF CACHE INTERNAL "")
FetchContent_MakeAvailable(nlohmann_json)

FetchContent_Declare(
  miniaudio
  URL https://raw.githubusercontent.com/mackron/miniaudio/0.11.25/miniaudio.h
  URL_HASH SHA256=ac7af4de748b7e26b777f37e01cee313a308a7296a3eb080e2906b320cc55c89
  DOWNLOAD_NO_EXTRACT TRUE
  DOWNLOAD_NAME miniaudio.h
)
FetchContent_MakeAvailable(miniaudio)

add_executable(copilot-speech-helper voice-helper.cpp)
target_compile_features(copilot-speech-helper PRIVATE cxx_std_20)
target_include_directories(copilot-speech-helper SYSTEM PRIVATE "${miniaudio_SOURCE_DIR}")
target_link_libraries(copilot-speech-helper PRIVATE nlohmann_json::nlohmann_json)

set(COPILOT_SPEECH_RUNTIME_DIR
  "${CMAKE_CURRENT_SOURCE_DIR}/../../dist/native/runtime/${COPILOT_SPEECH_RUNTIME_TARGET}")
set_target_properties(copilot-speech-helper PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${COPILOT_SPEECH_RUNTIME_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG "${COPILOT_SPEECH_RUNTIME_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${COPILOT_SPEECH_RUNTIME_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${COPILOT_SPEECH_RUNTIME_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${COPILOT_SPEECH_RUNTIME_DIR}"
)

if(WIN32)
  target_compile_definitions(copilot-speech-helper PRIVATE _CRT_SECURE_NO_WARNINGS)
elseif(APPLE)
  target_link_libraries(copilot-speech-helper PRIVATE
    "-framework AudioToolbox"
    "-framework CoreAudio"
    "-framework CoreFoundation"
    "-framework Foundation"
  )
endif()

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
    -P ${CMAKE_CURRENT_SOURCE_DIR}/protocol-test.cmake
)
