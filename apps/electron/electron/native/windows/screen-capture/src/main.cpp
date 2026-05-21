#include <windows.h>
#include <algorithm>
#include <cstdint>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

static const char* BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static std::string base64Encode(const std::vector<unsigned char>& data) {
    std::string output;
    int value = 0;
    int bits = -6;
    for (unsigned char byte : data) {
        value = (value << 8) + byte;
        bits += 8;
        while (bits >= 0) {
            output.push_back(BASE64[(value >> bits) & 0x3F]);
            bits -= 6;
        }
    }
    if (bits > -6) {
        output.push_back(BASE64[((value << 8) >> (bits + 8)) & 0x3F]);
    }
    while (output.size() % 4) {
        output.push_back('=');
    }
    return output;
}

static void appendBytes(std::vector<unsigned char>& out, const void* source, size_t size) {
    const auto* bytes = static_cast<const unsigned char*>(source);
    out.insert(out.end(), bytes, bytes + size);
}

struct MonitorCaptureTarget {
    HMONITOR monitor;
    RECT rect;
    bool hasCursor;
};

static BOOL CALLBACK collectMonitor(HMONITOR monitor, HDC, LPRECT rect, LPARAM data) {
    auto* targets = reinterpret_cast<std::vector<MonitorCaptureTarget>*>(data);
    POINT cursor;
    GetCursorPos(&cursor);
    targets->push_back({monitor, *rect, PtInRect(rect, cursor) != 0});
    return TRUE;
}

static std::string captureLabel(int index, int count, bool hasCursor) {
    if (count == 1) {
        return "user's screen (cursor is here)";
    }
    std::ostringstream label;
    label << "screen " << (index + 1) << " of " << count;
    if (hasCursor) {
        label << " - cursor is on this screen (primary focus)";
    } else {
        label << " - secondary screen";
    }
    return label.str();
}

static std::vector<unsigned char> captureRectAsBmp(HDC screen, const RECT& rect) {
    int width = rect.right - rect.left;
    int height = rect.bottom - rect.top;
    HDC memory = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, width, height);
    if (!memory || !bitmap) {
        throw std::runtime_error("Failed to initialize GDI capture.");
    }

    HGDIOBJ old = SelectObject(memory, bitmap);
    BOOL copied = BitBlt(memory, 0, 0, width, height, screen, rect.left, rect.top, SRCCOPY | CAPTUREBLT);
    SelectObject(memory, old);
    if (!copied) {
        DeleteObject(bitmap);
        DeleteDC(memory);
        throw std::runtime_error("BitBlt failed.");
    }

    BITMAPINFOHEADER header = {};
    header.biSize = sizeof(BITMAPINFOHEADER);
    header.biWidth = width;
    header.biHeight = height;
    header.biPlanes = 1;
    header.biBitCount = 32;
    header.biCompression = BI_RGB;

    DWORD pixelBytes = static_cast<DWORD>(width * height * 4);
    std::vector<unsigned char> pixels(pixelBytes);
    if (!GetDIBits(screen, bitmap, 0, height, pixels.data(), reinterpret_cast<BITMAPINFO*>(&header), DIB_RGB_COLORS)) {
        DeleteObject(bitmap);
        DeleteDC(memory);
        throw std::runtime_error("GetDIBits failed.");
    }

    BITMAPFILEHEADER fileHeader = {};
    fileHeader.bfType = 0x4D42;
    fileHeader.bfOffBits = sizeof(BITMAPFILEHEADER) + sizeof(BITMAPINFOHEADER);
    fileHeader.bfSize = fileHeader.bfOffBits + pixelBytes;

    std::vector<unsigned char> bmp;
    appendBytes(bmp, &fileHeader, sizeof(fileHeader));
    appendBytes(bmp, &header, sizeof(header));
    appendBytes(bmp, pixels.data(), pixels.size());
    DeleteObject(bitmap);
    DeleteDC(memory);
    return bmp;
}

int main() {
    HDC screen = GetDC(nullptr);
    if (!screen) {
        std::cerr << "Failed to acquire screen DC." << std::endl;
        return 1;
    }

    std::vector<MonitorCaptureTarget> targets;
    EnumDisplayMonitors(nullptr, nullptr, collectMonitor, reinterpret_cast<LPARAM>(&targets));
    std::stable_sort(targets.begin(), targets.end(), [](const auto& left, const auto& right) {
        if (left.hasCursor != right.hasCursor) {
            return left.hasCursor;
        }
        return left.rect.left < right.rect.left;
    });

    std::cout << "[";
    for (size_t i = 0; i < targets.size(); ++i) {
        const RECT& rect = targets[i].rect;
        int width = rect.right - rect.left;
        int height = rect.bottom - rect.top;
        std::vector<unsigned char> bmp;
        try {
            bmp = captureRectAsBmp(screen, rect);
        } catch (const std::exception& error) {
            std::cerr << error.what() << std::endl;
            ReleaseDC(nullptr, screen);
            return 1;
        }
        if (i > 0) {
            std::cout << ",";
        }
        std::cout
            << "{\"screenIndex\":" << i
            << ",\"displayId\":" << reinterpret_cast<std::uintptr_t>(targets[i].monitor)
            << ",\"x\":" << rect.left
            << ",\"y\":" << rect.top
            << ",\"width\":" << width
            << ",\"height\":" << height
            << ",\"label\":\"" << captureLabel(static_cast<int>(i), static_cast<int>(targets.size()), targets[i].hasCursor)
            << "\",\"isCursorScreen\":" << (targets[i].hasCursor ? "true" : "false")
            << ",\"screenshotWidthInPixels\":" << width
            << ",\"screenshotHeightInPixels\":" << height
            << ",\"mediaType\":\"image/bmp\",\"data\":\"" << base64Encode(bmp)
            << "\"}";
    }
    std::cout << "]" << std::endl;

    ReleaseDC(nullptr, screen);
    return 0;
}
