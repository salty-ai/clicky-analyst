cmake_minimum_required(VERSION 3.20)
project(glide_screen_capture LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(glide-screen-capture src/main.cpp)
target_link_libraries(glide-screen-capture PRIVATE gdi32 gdiplus user32 ole32)
