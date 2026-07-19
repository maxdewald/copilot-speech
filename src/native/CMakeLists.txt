cmake_minimum_required(VERSION 3.20)
project(copilot_speech_helper VERSION 0.1.0 LANGUAGES CXX)

if(POLICY CMP0135)
  cmake_policy(SET CMP0135 NEW)
endif()

if(NOT DEFINED COPILOT_SPEECH_DEPS_DIR)
  message(FATAL_ERROR "COPILOT_SPEECH_DEPS_DIR is required. Run: pnpm native:configure")
endif()
if(NOT DEFINED COPILOT_SPEECH_RUNTIME_TARGET)
  message(FATAL_ERROR "COPILOT_SPEECH_RUNTIME_TARGET is required. Run: pnpm native:configure")
endif()

include(FetchContent)

# Header-only deps are owned by CMake, not the Node native script.
FetchContent_Declare(
  nlohmann_json
  URL https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz
  URL_HASH SHA256=42f6e95cad6ec532fd372391373363b62a14af6d771056dbfc86160e6dfff7aa
)
set(JSON_BuildTests OFF CACHE INTERNAL "")
set(JSON_Install OFF CACHE INTERNAL "")
FetchContent_MakeAvailable(nlohmann_json)

# Single-header download keeps the pin small (full tag archive is multi-MB source).
FetchContent_Declare(
  miniaudio
  URL https://raw.githubusercontent.com/mackron/miniaudio/0.11.25/miniaudio.h
  URL_HASH SHA256=ac7af4de748b7e26b777f37e01cee313a308a7296a3eb080e2906b320cc55c89
  DOWNLOAD_NO_EXTRACT TRUE
  DOWNLOAD_NAME miniaudio.h
)
FetchContent_MakeAvailable(miniaudio)

set(MS_DIR "${COPILOT_SPEECH_DEPS_DIR}/moonshine")
if(EXISTS "${COPILOT_SPEECH_DEPS_DIR}/version")
  file(READ "${COPILOT_SPEECH_DEPS_DIR}/version" MOONSHINE_VERSION)
  string(STRIP "${MOONSHINE_VERSION}" MOONSHINE_VERSION)
  message(STATUS "Using Moonshine Voice ${MOONSHINE_VERSION}")
endif()

if(WIN32)
  set(MS_ROOT "${MS_DIR}/moonshine-voice-windows-x86_64")
  set(MOONSHINE_INCLUDE_DIR "${MS_ROOT}/include")
  set(MOONSHINE_LIBRARY "${MS_ROOT}/lib/moonshine.lib")
  add_library(moonshine STATIC IMPORTED GLOBAL)
  set(EXTRA_LINK_TARGETS "")
  foreach(extra moonshine-utils ort-utils bin-tokenizer onnxruntime)
    add_library(${extra} STATIC IMPORTED GLOBAL)
    set_target_properties(${extra} PROPERTIES IMPORTED_LOCATION "${MS_ROOT}/lib/${extra}.lib")
    list(APPEND EXTRA_LINK_TARGETS ${extra})
  endforeach()
elseif(APPLE)
  set(MOONSHINE_INCLUDE_DIR "${COPILOT_SPEECH_DEPS_DIR}/include")
  set(MOONSHINE_LIBRARY "${MS_DIR}/moonshine_voice/libmoonshine.dylib")
  add_library(moonshine SHARED IMPORTED GLOBAL)
  set(EXTRA_LINK_TARGETS "")
else()
  set(MOONSHINE_INCLUDE_DIR "${COPILOT_SPEECH_DEPS_DIR}/include")
  set(MOONSHINE_LIBRARY "${MS_DIR}/moonshine_voice/libmoonshine.so")
  add_library(moonshine SHARED IMPORTED GLOBAL)
  set(EXTRA_LINK_TARGETS "")
endif()

set_target_properties(moonshine PROPERTIES
  IMPORTED_LOCATION "${MOONSHINE_LIBRARY}"
  INTERFACE_INCLUDE_DIRECTORIES "${MOONSHINE_INCLUDE_DIR}"
)

add_executable(copilot-speech-helper voice-helper.cpp)
target_compile_features(copilot-speech-helper PRIVATE cxx_std_20)
target_include_directories(copilot-speech-helper SYSTEM PRIVATE "${miniaudio_SOURCE_DIR}")
target_link_libraries(copilot-speech-helper PRIVATE
  moonshine
  nlohmann_json::nlohmann_json
  ${EXTRA_LINK_TARGETS}
)

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
  add_custom_command(TARGET copilot-speech-helper POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${MS_ROOT}/lib/onnxruntime.dll"
      "${COPILOT_SPEECH_RUNTIME_DIR}/"
  )
elseif(APPLE)
  target_link_libraries(copilot-speech-helper PRIVATE
    "-framework AudioToolbox"
    "-framework CoreAudio"
    "-framework CoreFoundation"
    "-framework Foundation"
  )
  set_target_properties(copilot-speech-helper PROPERTIES BUILD_RPATH "@loader_path")
  file(GLOB MOONSHINE_ONNX
    "${MS_DIR}/moonshine_voice.libs/libonnxruntime*.dylib"
    "${MS_DIR}/moonshine_voice/libonnxruntime*.dylib"
    "${MS_DIR}/libonnxruntime*.dylib"
  )
  if(NOT MOONSHINE_ONNX)
    message(FATAL_ERROR "No ONNX Runtime dylib found under ${MS_DIR}")
  endif()
  list(SORT MOONSHINE_ONNX)
  list(REVERSE MOONSHINE_ONNX)
  list(GET MOONSHINE_ONNX 0 MOONSHINE_ONNX_LIB)
  add_custom_command(TARGET copilot-speech-helper POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${MOONSHINE_LIBRARY}"
      "${COPILOT_SPEECH_RUNTIME_DIR}/"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${MOONSHINE_ONNX_LIB}"
      "${COPILOT_SPEECH_RUNTIME_DIR}/"
  )
else()
  set_target_properties(copilot-speech-helper PROPERTIES BUILD_RPATH "$ORIGIN/moonshine_voice")
  file(GLOB MOONSHINE_ONNX "${MS_DIR}/moonshine_voice.libs/libonnxruntime*.so*")
  if(NOT MOONSHINE_ONNX)
    message(FATAL_ERROR "No ONNX Runtime library found under ${MS_DIR}/moonshine_voice.libs")
  endif()
  list(SORT MOONSHINE_ONNX)
  list(REVERSE MOONSHINE_ONNX)
  list(GET MOONSHINE_ONNX 0 MOONSHINE_ONNX_LIB)
  add_custom_command(TARGET copilot-speech-helper POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${COPILOT_SPEECH_RUNTIME_DIR}/moonshine_voice"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${MOONSHINE_LIBRARY}"
      "${COPILOT_SPEECH_RUNTIME_DIR}/moonshine_voice/"
    COMMAND ${CMAKE_COMMAND} -E make_directory "${COPILOT_SPEECH_RUNTIME_DIR}/moonshine_voice.libs"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${MOONSHINE_ONNX_LIB}"
      "${COPILOT_SPEECH_RUNTIME_DIR}/moonshine_voice.libs/"
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
