cmake_minimum_required(VERSION 3.20)
project(piksy_screen_capture LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(piksy-screen-capture src/main.cpp)
target_link_libraries(piksy-screen-capture PRIVATE gdi32 user32)
