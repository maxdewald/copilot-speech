cmake_minimum_required(VERSION 3.20)
project(copilot_speech_helper VERSION 0.1.0 LANGUAGES CXX)

set(MOONSHINE_VERSION "0.0.69")
set(MOONSHINE_ROOT "${CMAKE_CURRENT_BINARY_DIR}/moonshine-${MOONSHINE_VERSION}")
set(MOONSHINE_INCLUDE_DIR "${MOONSHINE_ROOT}/include")
set(MINIAUDIO_VERSION "0.11.25")
set(MINIAUDIO_INCLUDE_DIR "${CMAKE_CURRENT_BINARY_DIR}/miniaudio-${MINIAUDIO_VERSION}")
set(NLOHMANN_JSON_VERSION "3.12.0")
set(NLOHMANN_JSON_INCLUDE_DIR "${CMAKE_CURRENT_BINARY_DIR}/nlohmann-json-${NLOHMANN_JSON_VERSION}/include")

if(CMAKE_SYSTEM_NAME STREQUAL "Linux" AND CMAKE_SYSTEM_PROCESSOR MATCHES "^(x86_64|AMD64)$")
  set(COPILOT_SPEECH_RUNTIME_TARGET "linux-x64")
  set(MOONSHINE_WHEEL_URL "https://files.pythonhosted.org/packages/e7/52/37be3f40f6041ea419fafca694995c40febcac60923893d4d75845ad56af/moonshine_voice-0.0.69-py3-none-manylinux_2_34_x86_64.whl")
  set(MOONSHINE_WHEEL_HASH "SHA256=4e0da7167f2c87a7a8bba145b672ccad2a44115ca01d10a1dd15ec4f4b1c3c73")
  set(MOONSHINE_WHEEL "${MOONSHINE_ROOT}/moonshine.whl")
  set(MOONSHINE_LIBRARY "${MOONSHINE_ROOT}/moonshine_voice/libmoonshine.so")
  set(MOONSHINE_ONNX_RUNTIME "${MOONSHINE_ROOT}/moonshine_voice.libs/libonnxruntime-13ab8084.so.1")
  set(MOONSHINE_RUNTIME_LAYOUT "linux-wheel")
elseif(CMAKE_SYSTEM_NAME STREQUAL "Darwin" AND CMAKE_SYSTEM_PROCESSOR STREQUAL "arm64")
  set(COPILOT_SPEECH_RUNTIME_TARGET "darwin-arm64")
  set(MOONSHINE_WHEEL_URL "https://files.pythonhosted.org/packages/e0/76/87aa9e29ab8c2f131a0119faaa286e83a234515a9ca82c5099d04e09ecd4/moonshine_voice-0.0.69-py3-none-macosx_15_0_arm64.whl")
  set(MOONSHINE_WHEEL_HASH "SHA256=7fa9d8da74d86ca279abc074fc6aa2b1570768f215080e43628c7b51e4ec428f")
  set(MOONSHINE_WHEEL "${MOONSHINE_ROOT}/moonshine.whl")
  set(MOONSHINE_LIBRARY "${MOONSHINE_ROOT}/moonshine_voice/libmoonshine.dylib")
  set(MOONSHINE_ONNX_RUNTIME "${MOONSHINE_ROOT}/moonshine_voice/libonnxruntime.1.23.2.dylib")
  set(MOONSHINE_RUNTIME_LAYOUT "flat-shared")
elseif(CMAKE_SYSTEM_NAME STREQUAL "Windows" AND CMAKE_SYSTEM_PROCESSOR MATCHES "^(x86_64|AMD64)$")
  set(COPILOT_SPEECH_RUNTIME_TARGET "win32-x64")
  set(MOONSHINE_ARCHIVE_URL "https://github.com/moonshine-ai/moonshine/releases/download/v${MOONSHINE_VERSION}/moonshine-voice-windows-x86_64.tar.gz")
  set(MOONSHINE_ARCHIVE_HASH "SHA256=9af4ba41cf471c4353f34b13fc96645fbb196a6ec35968d65dda5cce1c5f1711")
  set(MOONSHINE_ARCHIVE "${MOONSHINE_ROOT}/moonshine.tar.gz")
  set(MOONSHINE_WINDOWS_ROOT "${MOONSHINE_ROOT}/moonshine-voice-windows-x86_64")
  set(MOONSHINE_INCLUDE_DIR "${MOONSHINE_WINDOWS_ROOT}/include")
  set(MOONSHINE_LIBRARY "${MOONSHINE_WINDOWS_ROOT}/lib/moonshine.lib")
  set(MOONSHINE_ONNX_LIBRARY "${MOONSHINE_WINDOWS_ROOT}/lib/onnxruntime.lib")
  set(MOONSHINE_ONNX_RUNTIME "${MOONSHINE_WINDOWS_ROOT}/lib/onnxruntime.dll")
  set(MOONSHINE_RUNTIME_LAYOUT "windows-static")
else()
  message(FATAL_ERROR "Moonshine Voice is not configured for ${CMAKE_SYSTEM_NAME} ${CMAKE_SYSTEM_PROCESSOR} yet.")
endif()

if(DEFINED MOONSHINE_WHEEL AND NOT EXISTS "${MOONSHINE_LIBRARY}")
  file(MAKE_DIRECTORY "${MOONSHINE_ROOT}")
  file(DOWNLOAD "${MOONSHINE_WHEEL_URL}" "${MOONSHINE_WHEEL}"
    EXPECTED_HASH "${MOONSHINE_WHEEL_HASH}"
    SHOW_PROGRESS
    STATUS download_status
  )
  list(GET download_status 0 download_error)
  if(NOT download_error EQUAL 0)
    list(GET download_status 1 download_message)
    message(FATAL_ERROR "Failed to download Moonshine Voice: ${download_message}")
  endif()
  file(ARCHIVE_EXTRACT INPUT "${MOONSHINE_WHEEL}" DESTINATION "${MOONSHINE_ROOT}")
elseif(DEFINED MOONSHINE_ARCHIVE AND NOT EXISTS "${MOONSHINE_LIBRARY}")
  file(MAKE_DIRECTORY "${MOONSHINE_ROOT}")
  file(DOWNLOAD "${MOONSHINE_ARCHIVE_URL}" "${MOONSHINE_ARCHIVE}"
    EXPECTED_HASH "${MOONSHINE_ARCHIVE_HASH}"
    SHOW_PROGRESS
    STATUS download_status
  )
  list(GET download_status 0 download_error)
  if(NOT download_error EQUAL 0)
    list(GET download_status 1 download_message)
    message(FATAL_ERROR "Failed to download Moonshine Voice: ${download_message}")
  endif()
  file(ARCHIVE_EXTRACT INPUT "${MOONSHINE_ARCHIVE}" DESTINATION "${MOONSHINE_ROOT}")
endif()

file(MAKE_DIRECTORY "${MOONSHINE_INCLUDE_DIR}")
foreach(header IN ITEMS moonshine-c-api.h moonshine-cpp.h)
  if(NOT EXISTS "${MOONSHINE_INCLUDE_DIR}/${header}")
    if(header STREQUAL "moonshine-c-api.h")
      set(header_hash "SHA256=30018163ddf427d4bd422247cbef695f5a2848201209483d8ac7c0caf0e879fb")
    else()
      set(header_hash "SHA256=f6ef0f9368a4971c62b6dbe313bb31c1353669cd754a165ed9b257791aca1053")
    endif()
    file(DOWNLOAD
      "https://raw.githubusercontent.com/moonshine-ai/moonshine/v${MOONSHINE_VERSION}/core/${header}"
      "${MOONSHINE_INCLUDE_DIR}/${header}"
      EXPECTED_HASH "${header_hash}"
      STATUS header_status
    )
    list(GET header_status 0 header_error)
    if(NOT header_error EQUAL 0)
      list(GET header_status 1 header_message)
      message(FATAL_ERROR "Failed to download ${header}: ${header_message}")
    endif()
  endif()
endforeach()

if(NOT EXISTS "${MINIAUDIO_INCLUDE_DIR}/miniaudio.h")
  file(MAKE_DIRECTORY "${MINIAUDIO_INCLUDE_DIR}")
  file(DOWNLOAD
    "https://raw.githubusercontent.com/mackron/miniaudio/${MINIAUDIO_VERSION}/miniaudio.h"
    "${MINIAUDIO_INCLUDE_DIR}/miniaudio.h"
    EXPECTED_HASH "SHA256=ac7af4de748b7e26b777f37e01cee313a308a7296a3eb080e2906b320cc55c89"
    STATUS miniaudio_status
  )
  list(GET miniaudio_status 0 miniaudio_error)
  if(NOT miniaudio_error EQUAL 0)
    list(GET miniaudio_status 1 miniaudio_message)
    message(FATAL_ERROR "Failed to download miniaudio: ${miniaudio_message}")
  endif()
endif()

if(NOT EXISTS "${NLOHMANN_JSON_INCLUDE_DIR}/nlohmann/json.hpp")
  file(MAKE_DIRECTORY "${NLOHMANN_JSON_INCLUDE_DIR}/nlohmann")
  file(DOWNLOAD
    "https://raw.githubusercontent.com/nlohmann/json/v${NLOHMANN_JSON_VERSION}/single_include/nlohmann/json.hpp"
    "${NLOHMANN_JSON_INCLUDE_DIR}/nlohmann/json.hpp"
    EXPECTED_HASH "SHA256=aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63"
    STATUS nlohmann_json_status
  )
  list(GET nlohmann_json_status 0 nlohmann_json_error)
  if(NOT nlohmann_json_error EQUAL 0)
    list(GET nlohmann_json_status 1 nlohmann_json_message)
    message(FATAL_ERROR "Failed to download nlohmann/json: ${nlohmann_json_message}")
  endif()
endif()

if(MOONSHINE_RUNTIME_LAYOUT STREQUAL "windows-static")
  add_library(moonshine STATIC IMPORTED GLOBAL)
  set_target_properties(moonshine PROPERTIES
    IMPORTED_LOCATION "${MOONSHINE_LIBRARY}"
    INTERFACE_INCLUDE_DIRECTORIES "${MOONSHINE_INCLUDE_DIR}"
  )
  foreach(name IN ITEMS moonshine-utils ort-utils bin-tokenizer)
    add_library(${name} STATIC IMPORTED GLOBAL)
    set_target_properties(${name} PROPERTIES
      IMPORTED_LOCATION "${MOONSHINE_WINDOWS_ROOT}/lib/${name}.lib"
    )
  endforeach()
  add_library(onnxruntime STATIC IMPORTED GLOBAL)
  set_target_properties(onnxruntime PROPERTIES IMPORTED_LOCATION "${MOONSHINE_ONNX_LIBRARY}")
else()
  add_library(moonshine SHARED IMPORTED GLOBAL)
  set_target_properties(moonshine PROPERTIES
    IMPORTED_LOCATION "${MOONSHINE_LIBRARY}"
    INTERFACE_INCLUDE_DIRECTORIES "${MOONSHINE_INCLUDE_DIR}"
  )
endif()

add_executable(copilot-speech-helper voice-helper.cpp)
target_compile_features(copilot-speech-helper PRIVATE cxx_std_20)
target_include_directories(copilot-speech-helper SYSTEM PRIVATE
  "${MINIAUDIO_INCLUDE_DIR}"
  "${NLOHMANN_JSON_INCLUDE_DIR}"
)
target_link_libraries(copilot-speech-helper PRIVATE moonshine)
if(WIN32)
  target_link_libraries(copilot-speech-helper PRIVATE moonshine-utils ort-utils bin-tokenizer onnxruntime)
elseif(APPLE)
  target_link_libraries(copilot-speech-helper PRIVATE
    "-framework AudioToolbox"
    "-framework CoreAudio"
    "-framework CoreFoundation"
    "-framework Foundation"
  )
  set_target_properties(copilot-speech-helper PROPERTIES BUILD_RPATH "@loader_path")
else()
  set_target_properties(copilot-speech-helper PROPERTIES BUILD_RPATH "$ORIGIN/moonshine_voice")
endif()

set(COPILOT_SPEECH_RUNTIME_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../runtime/${COPILOT_SPEECH_RUNTIME_TARGET}")
set_target_properties(copilot-speech-helper PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${COPILOT_SPEECH_RUNTIME_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG "${COPILOT_SPEECH_RUNTIME_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${COPILOT_SPEECH_RUNTIME_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${COPILOT_SPEECH_RUNTIME_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${COPILOT_SPEECH_RUNTIME_DIR}"
)

if(MOONSHINE_RUNTIME_LAYOUT STREQUAL "linux-wheel")
  add_custom_command(TARGET copilot-speech-helper POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory
      "${COPILOT_SPEECH_RUNTIME_DIR}/moonshine_voice"
      "${COPILOT_SPEECH_RUNTIME_DIR}/moonshine_voice.libs"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${MOONSHINE_LIBRARY}"
      "${COPILOT_SPEECH_RUNTIME_DIR}/moonshine_voice"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${MOONSHINE_ONNX_RUNTIME}"
      "${COPILOT_SPEECH_RUNTIME_DIR}/moonshine_voice.libs"
  )
else()
  add_custom_command(TARGET copilot-speech-helper POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${MOONSHINE_ONNX_RUNTIME}"
      "${COPILOT_SPEECH_RUNTIME_DIR}"
  )
  if(MOONSHINE_RUNTIME_LAYOUT STREQUAL "flat-shared")
    add_custom_command(TARGET copilot-speech-helper POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${MOONSHINE_LIBRARY}"
        "${COPILOT_SPEECH_RUNTIME_DIR}"
    )
  endif()
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