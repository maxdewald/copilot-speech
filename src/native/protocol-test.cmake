set(input "not-json\n{\"type\":\"hello\",\"protocolVersion\":2}\n{\"type\":\"start\",\"sessionId\":\"test\\\"quoted\",\"modelPath\":\"\",\"modelArchitecture\":5}\n{\"type\":\"cancel\",\"sessionId\":\"test\\\"quoted\"}\n{\"type\":\"stop\",\"sessionId\":\"test\\\"quoted\"}\n")
set(input_file "${CMAKE_CURRENT_BINARY_DIR}/protocol-input.ndjson")
file(WRITE "${input_file}" "${input}")

execute_process(
  COMMAND "${CMAKE_COMMAND}" -E env
    COPILOT_SPEECH_STUB_TRANSCRIPT=test
    "${HELPER}" --stdio
  INPUT_FILE "${input_file}"
  OUTPUT_VARIABLE output
  ERROR_VARIABLE error
  RESULT_VARIABLE result
)

file(REMOVE "${input_file}")

if(NOT result EQUAL 0)
  message(FATAL_ERROR "helper exited ${result}: ${error}")
endif()

foreach(expected IN ITEMS
  "\"code\":\"invalid_command\""
  "{\"helperVersion\":\"0.1.0\",\"protocolVersion\":2,\"type\":\"hello\"}"
  "{\"sessionId\":\"test\\\"quoted\",\"type\":\"recording\"}"
  "{\"sessionId\":\"test\\\"quoted\",\"type\":\"cancelled\"}"
)
  string(FIND "${output}" "${expected}" position)
  if(position EQUAL -1)
    message(FATAL_ERROR "missing ${expected} in helper output: ${output}")
  endif()
endforeach()