set(input "{\"type\":\"hello\",\"protocolVersion\":1}\n{\"type\":\"start\",\"sessionId\":\"test\",\"modelPath\":\"\"}\n{\"type\":\"cancel\",\"sessionId\":\"test\"}\n")
set(input_file "${CMAKE_CURRENT_BINARY_DIR}/protocol-input.ndjson")
file(WRITE "${input_file}" "${input}")

execute_process(
  COMMAND "${HELPER}" --stdio
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
  "{\"type\":\"hello\",\"protocolVersion\":1,\"helperVersion\":\"0.1.0-stub\"}"
  "{\"type\":\"recording\",\"sessionId\":\"test\"}"
  "{\"type\":\"cancelled\",\"sessionId\":\"test\"}"
)
  string(FIND "${output}" "${expected}" position)
  if(position EQUAL -1)
    message(FATAL_ERROR "missing ${expected} in helper output: ${output}")
  endif()
endforeach()