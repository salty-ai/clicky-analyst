#include <windows.h>
#include <gdiplus.h>
#include <algorithm>
#include <cstdint>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#pragma comment(lib, "gdiplus.lib")

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

static int getEncoderClsid(const WCHAR* format, CLSID* pClsid) {
    UINT num = 0, size = 0;
    Gdiplus::GetImageEncodersSize(&num, &size);
    if (size == 0) return -1;
    std::vector<unsigned char> buf(size);
    auto* encoders = reinterpret_cast<Gdiplus::ImageCodecInfo*>(buf.data());
    Gdiplus::GetImageEncoders(num, size, encoders);
    for (UINT i = 0; i < num; ++i) {
        if (wcscmp(encoders[i].MimeType, format) == 0) {
            *pClsid = encoders[i].Clsid;
            return static_cast<int>(i);
        }
    }
    return -1;
}

static std::vector<unsigned char> captureRectAsJpeg(HDC screen, const RECT& rect, int maxDimension, int* outWidth, int* outHeight) {
    int srcWidth = rect.right - rect.left;
    int srcHeight = rect.bottom - rect.top;

    // Calculate scaled dimensions (max 1280px like Mac)
    int dstWidth, dstHeight;
    if (srcWidth >= srcHeight) {
        dstWidth = (std::min)(srcWidth, maxDimension);
        dstHeight = static_cast<int>(static_cast<double>(dstWidth) * srcHeight / srcWidth);
    } else {
        dstHeight = (std::min)(srcHeight, maxDimension);
        dstWidth = static_cast<int>(static_cast<double>(dstHeight) * srcWidth / srcHeight);
    }

    // Capture full resolution
    HDC memDC = CreateCompatibleDC(screen);
    HBITMAP hBitmap = CreateCompatibleBitmap(screen, srcWidth, srcHeight);
    HGDIOBJ old = SelectObject(memDC, hBitmap);
    BitBlt(memDC, 0, 0, srcWidth, srcHeight, screen, rect.left, rect.top, SRCCOPY | CAPTUREBLT);
    SelectObject(memDC, old);
    DeleteDC(memDC);

    // Create GDI+ bitmap from HBITMAP and scale
    Gdiplus::Bitmap srcBitmap(hBitmap, nullptr);
    DeleteObject(hBitmap);

    Gdiplus::Bitmap dstBitmap(dstWidth, dstHeight, PixelFormat32bppARGB);
    Gdiplus::Graphics graphics(&dstBitmap);
    graphics.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
    graphics.DrawImage(&srcBitmap, 0, 0, dstWidth, dstHeight);

    // Encode as JPEG with 80% quality
    CLSID jpegClsid;
    getEncoderClsid(L"image/jpeg", &jpegClsid);
    Gdiplus::EncoderParameters encoderParams;
    encoderParams.Count = 1;
    encoderParams.Parameter[0].Guid = Gdiplus::EncoderQuality;
    encoderParams.Parameter[0].Type = Gdiplus::EncoderParameterValueTypeLong;
    encoderParams.Parameter[0].NumberOfValues = 1;
    ULONG quality = 80;
    encoderParams.Parameter[0].Value = &quality;

    // Save to IStream
    IStream* stream = nullptr;
    CreateStreamOnHGlobal(nullptr, TRUE, &stream);
    dstBitmap.Save(stream, &jpegClsid, &encoderParams);

    // Read stream into vector
    STATSTG stat;
    stream->Stat(&stat, STATFLAG_NONAME);
    ULONG dataSize = static_cast<ULONG>(stat.cbSize.QuadPart);
    std::vector<unsigned char> jpegData(dataSize);
    LARGE_INTEGER seekPos;
    seekPos.QuadPart = 0;
    stream->Seek(seekPos, STREAM_SEEK_SET, nullptr);
    ULONG bytesRead = 0;
    stream->Read(jpegData.data(), dataSize, &bytesRead);
    stream->Release();

    *outWidth = dstWidth;
    *outHeight = dstHeight;
    return jpegData;
}

int main() {
    // Initialize GDI+
    Gdiplus::GdiplusStartupInput gdiplusStartupInput;
    ULONG_PTR gdiplusToken;
    Gdiplus::GdiplusStartup(&gdiplusToken, &gdiplusStartupInput, nullptr);

    HDC screen = GetDC(nullptr);
    if (!screen) {
        std::cerr << "Failed to acquire screen DC." << std::endl;
        Gdiplus::GdiplusShutdown(gdiplusToken);
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

    static const int MAX_DIMENSION = 1280;

    std::cout << "[";
    for (size_t i = 0; i < targets.size(); ++i) {
        const RECT& rect = targets[i].rect;
        int width = rect.right - rect.left;
        int height = rect.bottom - rect.top;
        int outWidth = 0, outHeight = 0;
        std::vector<unsigned char> jpeg;
        try {
            jpeg = captureRectAsJpeg(screen, rect, MAX_DIMENSION, &outWidth, &outHeight);
        } catch (...) {
            std::cerr << "Failed to capture monitor " << i << std::endl;
            ReleaseDC(nullptr, screen);
            Gdiplus::GdiplusShutdown(gdiplusToken);
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
            << ",\"screenshotWidthInPixels\":" << outWidth
            << ",\"screenshotHeightInPixels\":" << outHeight
            << ",\"mediaType\":\"image/jpeg\",\"data\":\"" << base64Encode(jpeg)
            << "\"}";
    }
    std::cout << "]" << std::endl;

    ReleaseDC(nullptr, screen);
    Gdiplus::GdiplusShutdown(gdiplusToken);
    return 0;
}
