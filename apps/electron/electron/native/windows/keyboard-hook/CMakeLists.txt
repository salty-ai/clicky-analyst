cmake_minimum_required(VERSION 3.20)
project(piksy_keyboard_hook LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(piksy-keyboard-hook src/main.cpp)
target_link_libraries(piksy-keyboard-hook PRIVATE user32)
