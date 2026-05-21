#include <windows.h>
#include <atomic>
#include <iostream>
#include <string>
#include <thread>

static HHOOK g_hook = nullptr;
static std::atomic<bool> g_running{true};
static bool g_wasActive = false;
static DWORD g_mainThreadId = 0;

static bool isKeyDown(int vk) {
    return (GetAsyncKeyState(vk) & 0x8000) != 0;
}

static void emitStateIfChanged() {
    bool active = isKeyDown(VK_CONTROL) && isKeyDown(VK_MENU);
    if (active == g_wasActive) {
        return;
    }
    g_wasActive = active;
    std::cout << (active ? "SHORTCUT_DOWN" : "SHORTCUT_UP") << std::endl;
}

static LRESULT CALLBACK keyboardProc(int code, WPARAM wParam, LPARAM lParam) {
    if (code == HC_ACTION && (wParam == WM_KEYDOWN || wParam == WM_KEYUP || wParam == WM_SYSKEYDOWN || wParam == WM_SYSKEYUP)) {
        emitStateIfChanged();
    }
    return CallNextHookEx(g_hook, code, wParam, lParam);
}

static void stdinListener() {
    std::string line;
    while (std::getline(std::cin, line)) {
        if (line == "stop") {
            g_running.store(false);
            PostThreadMessage(g_mainThreadId, WM_QUIT, 0, 0);
            return;
        }
    }
    g_running.store(false);
}

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    g_mainThreadId = GetCurrentThreadId();
    g_hook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboardProc, GetModuleHandleW(nullptr), 0);
    if (!g_hook) {
        std::cerr << "Failed to install keyboard hook: " << GetLastError() << std::endl;
        return 1;
    }

    std::cout << "READY" << std::endl;

    std::thread listener(stdinListener);
    listener.detach();

    MSG msg;
    while (g_running.load() && GetMessage(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    UnhookWindowsHookEx(g_hook);
    return 0;
}
