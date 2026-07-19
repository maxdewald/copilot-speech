cmake_minimum_required(VERSION 3.20)
project(copilot_speech_helper VERSION 0.1.0 LANGUAGES CXX)

if(NOT DEFINED COPILOT_SPEECH_DEPS_DIR)
  message(FATAL_ERROR "COPILOT_SPEECH_DEPS_DIR is required. Run: pnpm native:configure")
endif()
if(NOT DEFINED COPILOT_SPEECH_RUNTIME_TARGET)
  message(FATAL_ERROR "COPILOT_SPEECH_RUNTIME_TARGET is required. Run: pnpm native:configure")
endif()

set(MANIFEST_PATH "${COPILOT_SPEECH_DEPS_DIR}/manifest.json")
if(NOT EXISTS "${MANIFEST_PATH}")
  message(FATAL_ERROR "Missing native deps manifest: ${MANIFEST_PATH}")
endif()
file(READ "${MANIFEST_PATH}" MANIFEST)

string(JSON MOONSHINE_VERSION GET "${MANIFEST}" version)
string(JSON MOONSHINE_INCLUDE_DIR GET "${MANIFEST}" includeDir)
string(JSON THIRD_PARTY_DIR GET "${MANIFEST}" thirdPartyDir)
string(JSON MOONSHINE_LIBRARY GET "${MANIFEST}" library)
string(JSON MOONSHINE_ONNX_RUNTIME GET "${MANIFEST}" onnxRuntime)
message(STATUS "Using Moonshine Voice ${MOONSHINE_VERSION}")

string(JSON EXTRA_LINK_LIB_COUNT LENGTH "${MANIFEST}" extraLinkLibs)
set(EXTRA_LINK_TARGETS "")
if(EXTRA_LINK_LIB_COUNT GREATER 0)
  math(EXPR EXTRA_LINK_LIB_LAST "${EXTRA_LINK_LIB_COUNT} - 1")
  foreach(index RANGE 0 ${EXTRA_LINK_LIB_LAST})
    string(JSON extra_lib GET "${MANIFEST}" extraLinkLibs ${index})
    get_filename_component(extra_name "${extra_lib}" NAME_WE)
    add_library(${extra_name} STATIC IMPORTED GLOBAL)
    set_target_properties(${extra_name} PROPERTIES IMPORTED_LOCATION "${extra_lib}")
    list(APPEND EXTRA_LINK_TARGETS ${extra_name})
  endforeach()
  add_library(moonshine STATIC IMPORTED GLOBAL)
else()
  add_library(moonshine SHARED IMPORTED GLOBAL)
endif()
set_target_properties(moonshine PROPERTIES
  IMPORTED_LOCATION "${MOONSHINE_LIBRARY}"
  INTERFACE_INCLUDE_DIRECTORIES "${MOONSHINE_INCLUDE_DIR}"
)

add_executable(copilot-speech-helper voice-helper.cpp)
target_compile_features(copilot-speech-helper PRIVATE cxx_std_20)
target_include_directories(copilot-speech-helper SYSTEM PRIVATE "${THIRD_PARTY_DIR}")
target_link_libraries(copilot-speech-helper PRIVATE moonshine ${EXTRA_LINK_TARGETS})

if(WIN32)
  target_compile_definitions(copilot-speech-helper PRIVATE _CRT_SECURE_NO_WARNINGS)
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

set(COPILOT_SPEECH_RUNTIME_DIR
  "${CMAKE_CURRENT_SOURCE_DIR}/../../dist/native/runtime/${COPILOT_SPEECH_RUNTIME_TARGET}")
set_target_properties(copilot-speech-helper PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${COPILOT_SPEECH_RUNTIME_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG "${COPILOT_SPEECH_RUNTIME_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${COPILOT_SPEECH_RUNTIME_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${COPILOT_SPEECH_RUNTIME_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${COPILOT_SPEECH_RUNTIME_DIR}"
)

string(JSON RUNTIME_COPY_COUNT LENGTH "${MANIFEST}" runtimeCopies)
if(RUNTIME_COPY_COUNT GREATER 0)
  math(EXPR RUNTIME_COPY_LAST "${RUNTIME_COPY_COUNT} - 1")
  set(RUNTIME_COPY_COMMANDS)
  foreach(index RANGE 0 ${RUNTIME_COPY_LAST})
    string(JSON copy_from GET "${MANIFEST}" runtimeCopies ${index} from)
    string(JSON copy_to GET "${MANIFEST}" runtimeCopies ${index} to)
    list(APPEND RUNTIME_COPY_COMMANDS
      COMMAND ${CMAKE_COMMAND} -E make_directory "${COPILOT_SPEECH_RUNTIME_DIR}/${copy_to}"
      COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${copy_from}"
        "${COPILOT_SPEECH_RUNTIME_DIR}/${copy_to}"
    )
  endforeach()
  add_custom_command(TARGET copilot-speech-helper POST_BUILD ${RUNTIME_COPY_COMMANDS})
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
