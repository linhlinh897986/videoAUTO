"""
mdouyin.py — Single-file Douyin mobile API client

Order of operations:
  1) Fetch tokens (xsstoken, webId) from the share page
  2) Generate reflow_id (AES-CBC over xsstoken using web_id[:16] as key/iv)
  3) Generate msToken (random 128-char allowed charset)
  4) Generate a_bogus from the request params
  5) Send the request

Dependencies (Python):
  - requests
  - beautifulsoup4
  - pycryptodome (Crypto)
  - gmssl

Usage examples (PowerShell):
  py "mdouyin.py" --sec-uid "<sec_uid>" --dry-run
  py "mdouyin.py" --sec-uid "<sec_uid>"
  py "mdouyin.py" --sec-uid "<sec_uid>" --cookie "<your_cookie_string>"
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import string
import sys
from typing import Any, Dict, List, Optional, Tuple, Union, cast

import requests
from bs4 import BeautifulSoup
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad
from gmssl import sm3, func


_VERBOSE: bool = False


def _set_verbose(enabled: bool) -> None:
    global _VERBOSE
    _VERBOSE = enabled


def _debug(msg: str) -> None:
    if _VERBOSE:
        print(msg, file=sys.stderr)


# -----------------------------
# Helpers: msToken, reflow_id
# -----------------------------

def get_ms_token(length: int = 128) -> str:
    """Generate a random msToken using letters, digits, '-' and '_'"""
    chars = string.ascii_letters + string.digits + "-_"
    return "".join(random.choice(chars) for _ in range(length))


def generate_reflow_id(xsstoken: str, web_id: str) -> str:
    """Generate reflow_id using AES-CBC with key and iv = web_id[:16]."""
    if len(web_id) < 16:
        raise ValueError("web_id must be at least 16 characters long")

    key_iv = web_id[:16].encode("utf-8")
    cipher = AES.new(key_iv, AES.MODE_CBC, key_iv)
    data = xsstoken.encode("utf-8")
    encrypted = cipher.encrypt(pad(data, AES.block_size))
    import base64

    return base64.b64encode(encrypted).decode("utf-8")


# ----------------------------------------
# Helper: fetch xsstoken & webId from HTML
# ----------------------------------------

def get_douyin_tokens(sec_uid: str, cookie: Optional[str] = None, timeout: int = 15) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Fetch the Douyin share page and extract xsstoken, webId, and usercip from known HTML hints.
    Returns (xsstoken, webId, user_cip) with None for any missing values.
    """
    url = f"https://m.douyin.com/share/user/{sec_uid}?scene_from=douyin_h5_search"
    headers = {
        # Match mobile behavior more closely to get expected HTML divs/tokens
        "user-agent": "Mozilla/5.0 (Linux; Android 8.0.0; SM-G955U Build/R16NW) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "accept-language": "vi,en-US;q=0.9,en;q=0.8",
        "referer": f"https://m.douyin.com/share/user/{sec_uid}?scene_from=douyin_h5_search",
        "sec-ch-ua": '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "upgrade-insecure-requests": "1",
        "priority": "u=0, i",
    }
    if cookie:
        headers["cookie"] = cookie

    resp = requests.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()

    html = resp.text
    soup = BeautifulSoup(html, "html.parser")

    xsstoken: Optional[str] = None
    web_id: Optional[str] = None
    user_cip: Optional[str] = None

    # Try div attributes first
    web_id_div = soup.find("div", id="douyin_reflow_webId")
    if web_id_div and "webid" in web_id_div.attrs:
        _val: Any = web_id_div.get("webid")
        if isinstance(_val, list):
            web_id = str(cast(Any, _val[0])) if _val else None
        elif _val is not None:
            web_id = str(_val)

    token_div = soup.find("div", id="douyin_reflow_token")
    if token_div and "xsstoken" in token_div.attrs:
        _tval: Any = token_div.get("xsstoken")
        if isinstance(_tval, list):
            xsstoken = str(cast(Any, _tval[0])) if _tval else None
        elif _tval is not None:
            xsstoken = str(_tval)

    # Fallback: look for RENDER_DATA in scripts
    if not xsstoken or not web_id:
        scripts = soup.find_all("script")
        for script in scripts:
            script_content = script.string
            if not script_content:
                continue
            if "RENDER_DATA" in script_content:
                try:
                    # crude extraction
                    m = re.search(r"RENDER_DATA\s*=\s*(\{.*?\})\s*;?\s*<", script_content, re.DOTALL)
                    if m:
                        render_str = m.group(1).encode("utf-8").decode("unicode_escape")
                        render_str = render_str.replace("\\u0000", "")
                        data = json.loads(render_str)
                        if not web_id:
                            web_id = (
                                data.get("app", {})
                                .get("odin", {})
                                .get("user_id")
                            )
                        if not xsstoken:
                            xsstoken = (
                                data.get("context", {})
                                .get("xsstoken")
                            )
                        if not user_cip:
                            # Try grabbing directly from the raw JSON string
                            m2 = re.search(r'"usercip"\s*:\s*"([^"\\]+)"', render_str)
                            if m2:
                                user_cip = m2.group(1)
                        if xsstoken and web_id:
                            break
                except Exception:
                    continue

    # Regex fallback: search raw HTML for "usercip":"<ip>"
    if not user_cip:
        m_ip = re.search(r'"usercip"\s*:\s*"([0-9]{1,3}(?:\.[0-9]{1,3}){3})"', html)
        if m_ip:
            user_cip = m_ip.group(1)

    # Save raw HTML to assist debugging when extraction fails
    if not xsstoken or not web_id:
        try:
            with open("response.txt", "w", encoding="utf-8") as f:
                f.write(html)
        except Exception:
            pass

    return xsstoken, web_id, user_cip


# -----------------------------
# Helper: a_bogus generator
# -----------------------------

class ABogus:
    __end_string = "cus"
    __str = {
        "s0": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
        "s1": "Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=",
        "s2": "Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=",
        "s3": "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe",
        "s4": "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe",
    }

    def __init__(self, user_agent: str = "", platform: str = "Win32"):
        self.user_agent = user_agent
        self.ua_code = self.generate_ua_code(user_agent)
        self.browser = self.generate_browser_info(platform)
        self.browser_len = len(self.browser)
        self.browser_code = self.char_code_at(self.browser)

    def generate_ua_code(self, user_agent: str) -> list[int]:
        numbers: list[float] = [0.00390625, 1, 14]
        key_string = ''.join(chr(int(num)) for num in numbers)
        return self.sm3_to_array(self.generate_result(self.rc4_encrypt(user_agent, key_string), "s3"))

    def list_1(self, a: int = 170, b: int = 85, c: int = 45) -> list[int]:
        return self.random_list(a, b, 1, 2, 5, c & a)

    def list_2(self, a: int = 170, b: int = 85) -> list[int]:
        return self.random_list(a, b, 1, 0, 0, 0)

    def list_3(self, a: int = 170, b: int = 85) -> list[int]:
        return self.random_list(a, b, 1, 0, 5, 0)

    def random_list(self, b: int = 170, c: int = 85, d: int = 0, e: int = 0, f: int = 0, g: int = 0) -> list[int]:
        r = random.random() * 10000
        v: list[Any] = [r, int(r) & 255, int(r) >> 8]
        s = v[1] & b | d
        v.append(s)
        s = v[1] & c | e
        v.append(s)
        s = v[2] & b | f
        v.append(s)
        s = v[2] & c | g
        v.append(s)
        return v[-4:]

    def from_char_code(self, *args: int) -> str:
        return "".join(chr(code) for code in args)

    def generate_string_1(self) -> str:
        return self.from_char_code(*self.list_1()) + self.from_char_code(*self.list_2()) + self.from_char_code(*self.list_3())

    def generate_string_2(self, url_params: str, method: str = "GET") -> str:
        a = self.generate_string_2_list(url_params, method)
        e = self.end_check_num(a)
        a.extend(self.browser_code)
        a.append(e)
        return self.rc4_encrypt(self.from_char_code(*a), "y")

    def generate_string_2_list(self, url_params: str, method: str = "GET") -> list[int]:
        import time
        from random import randint
        start_time = int(time.time() * 1000)
        end_time = start_time + randint(4, 8)
        params_array = self.generate_params_code(url_params)
        method_array = self.generate_method_code(method)
        return self.list_4(
            (end_time >> 24) & 255,
            params_array[21],
            self.ua_code[23],
            (end_time >> 16) & 255,
            params_array[22],
            self.ua_code[24],
            (end_time >> 8) & 255,
            (end_time >> 0) & 255,
            (start_time >> 24) & 255,
            (start_time >> 16) & 255,
            (start_time >> 8) & 255,
            (start_time >> 0) & 255,
            method_array[21],
            method_array[22],
            int(end_time / 256 / 256 / 256 / 256) >> 0,
            int(start_time / 256 / 256 / 256 / 256) >> 0,
            self.browser_len,
        )

    def list_4(self, a: int, b: int, c: int, d: int, e: int, f: int, g: int, h: int, i: int, j: int, k: int, m: int, n: int, o: int, p: int, q: int, r: int) -> list[int]:
        return [
            44, a, 0, 0, 0, 0, 24, b, n, 0, c, d, 0, 0, 0, 1, 0, 239, e, o, f, g, 0, 0, 0, 0, h, 0, 0, 14, i, j, 0, k, m, 3, p, 1, q, 1, r, 0, 0, 0
        ]

    def end_check_num(self, a: list[int]) -> int:
        r = 0
        for i in a:
            r ^= i
        return r

    def char_code_at(self, s: str) -> list[int]:
        return [ord(char) for char in s]

    def generate_result(self, s: str, e: str = "s4") -> str:
        r: list[str] = []
        for i in range(0, len(s), 3):
            if i + 2 < len(s):
                n = ((ord(s[i]) << 16) | (ord(s[i + 1]) << 8) | ord(s[i + 2]))
            elif i + 1 < len(s):
                n = ((ord(s[i]) << 16) | (ord(s[i + 1]) << 8))
            else:
                n = (ord(s[i]) << 16)
            for j, k in zip(range(18, -1, -6), (0xFC0000, 0x03F000, 0x0FC0, 0x3F)):
                if j == 6 and i + 1 >= len(s):
                    break
                if j == 0 and i + 2 >= len(s):
                    break
                r.append(self.__str[e][(n & k) >> j])
        r.append("=" * ((4 - len(r) % 4) % 4))
        return "".join(r)

    def generate_method_code(self, method: str = "GET") -> list[int]:
        return self.sm3_to_array(self.sm3_to_array(method + self.__end_string))

    def generate_params_code(self, params: str) -> list[int]:
        return self.sm3_to_array(self.sm3_to_array(params + self.__end_string))

    def sm3_to_array(self, data: str | list[int]) -> list[int]:
        if isinstance(data, str):
            b = data.encode("utf-8")
        else:
            b = bytes(data)
        h = sm3.sm3_hash(func.bytes_to_list(b))
        return [int(h[i: i + 2], 16) for i in range(0, len(h), 2)]

    def generate_browser_info(self, platform: str = "Win32") -> str:
        from random import choice, randint
        inner_width = randint(1280, 1920)
        inner_height = randint(720, 1080)
        outer_width = randint(inner_width, 1920)
        outer_height = randint(inner_height, 1080)
        screen_x = 0
        screen_y = choice((0, 30))
        value_list = [
            inner_width, inner_height, outer_width, outer_height, screen_x, screen_y,
            0, 0, outer_width, outer_height, outer_width, outer_height, inner_width, inner_height, 24, 24, platform,
        ]
        return "|".join(str(i) for i in value_list)

    def rc4_encrypt(self, plaintext: str, key: str) -> str:
        s = list(range(256))
        j = 0
        for i in range(256):
            j = (j + s[i] + ord(key[i % len(key)])) % 256
            s[i], s[j] = s[j], s[i]
        i = 0
        j = 0
        cipher: list[str] = []
        for k in range(len(plaintext)):
            i = (i + 1) % 256
            j = (j + s[i]) % 256
            s[i], s[j] = s[j], s[i]
            t = (s[i] + s[j]) % 256
            cipher.append(chr(s[t] ^ ord(plaintext[k])))
        return ''.join(cipher)

    def generate_a_bogus(self, url_params: Dict[str, object] | str) -> str:
        from urllib.parse import urlencode
        if isinstance(url_params, dict):
            encoded = urlencode(url_params)
        else:
            encoded = url_params
        string_1 = self.generate_string_1()
        string_2 = self.generate_string_2(encoded)
        string = string_1 + string_2
        return self.generate_result(string, "s4")


# -----------------------------
# Orchestration & request
# -----------------------------

def _runtime_search_dirs() -> list[str]:
    dirs: list[str] = []
    cwd = os.getcwd()
    if cwd:
        dirs.append(cwd)

    module_dir = os.path.dirname(os.path.abspath(__file__))
    if module_dir:
        dirs.append(module_dir)

    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        if exe_dir and exe_dir not in dirs:
            dirs.append(exe_dir)
        meipass = getattr(sys, "_MEIPASS", "")
        if meipass and meipass not in dirs:
            dirs.append(meipass)

    return dirs


def _resolve_path(p: str) -> str:
    """Return absolute path; resolve relative paths against runtime search dirs."""
    if os.path.isabs(p):
        return p

    candidates = [os.path.abspath(os.path.join(d, p)) for d in _runtime_search_dirs()]
    for cand in candidates:
        if os.path.exists(cand):
            return cand

    return candidates[0] if candidates else os.path.abspath(p)


def parse_netscape_cookie_file(path: str, target_domains: Optional[list[str]] = None) -> Optional[str]:
    """Parse a Netscape-format cookie file and return a Cookie header string.

    Format: domain, flag, path, secure, expiration, name, value (tab-separated).
    Lines starting with '#' are comments. Some lines may start with '#HttpOnly_'.
    If target_domains is provided, only include cookies where cookie domain endswith any of target_domains.
    """
    try:
        with open(_resolve_path(path), "r", encoding="utf-8") as f:
            lines = f.read().splitlines()
    except Exception:
        return None

    cookies: list[tuple[str, str]] = []
    for raw in lines:
        if not raw or raw.startswith("#"):
            # Allow "#HttpOnly_" prefix with tab-separated rest
            if raw.startswith("#HttpOnly_"):
                raw = raw[len("#HttpOnly_"):]
            else:
                continue

        # Split by tab first, else fallback to whitespace
        parts = raw.split("\t") if "\t" in raw else raw.split()
        if len(parts) < 7:
            continue

        domain = parts[0].strip()
        # parts[1] host-only flag, parts[2] path, parts[3] secure, parts[4] expiry
        name = parts[5]
        value = parts[6]

        if target_domains:
            dom_lower = domain.lower()
            ok = any(dom_lower.endswith(td.lower()) for td in target_domains)
            if not ok:
                continue

        if name and value:
            cookies.append((name, value))

    if not cookies:
        return None

    header = "; ".join(f"{n}={v}" for n, v in cookies)
    return header

def build_params_and_url(sec_uid: str, cookie: Optional[str] = None, count: int = 15) -> Tuple[Dict[str, object], str]:
    """Build request params and final URL for mobile posts API.

    count: number of items to request (mapped to `count` param).
    """
    base_url = "https://m.douyin.com/web/api/v2/aweme/post/"

    # Step 1: tokens -> reflow_id
    xsstoken, web_id, user_cip = get_douyin_tokens(sec_uid, cookie=cookie)
    if not xsstoken or not web_id:
        raise RuntimeError("Failed to extract xsstoken/webId from share page; pass --cookie with a fresh browser cookie and try again.")
    reflow_id = generate_reflow_id(xsstoken, web_id)

    # Step 2: msToken
    ms_token = get_ms_token()

    # Step 3: params and a_bogus
    user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    params: Dict[str, object] = {
        "reflow_source": "reflow_page",
        "web_id": web_id,
        "device_id": web_id,  # observed equal in provided URL
        "sec_uid": sec_uid,
        "count": count,
        "max_cursor": 0,
        "reflow_id": reflow_id,
        "msToken": ms_token,
    }

    if user_cip:
        params["user_cip"] = user_cip
    else:
        _debug("Note: usercip not found in HTML; leaving user_cip unset.")

    a_bogus = ABogus(user_agent).generate_a_bogus(params)
    params["a_bogus"] = a_bogus

    from urllib.parse import urlencode
    final_url = f"{base_url}?{urlencode(params)}"
    return params, final_url


def get_recent_aweme_ids(sec_uid: str, count: int = 30, cookie: Optional[str] = None, headless: bool = True, raw: bool = False) -> List[Any]:
    """Fetch the mobile API and return recent aweme items or ids.

    By default (raw=False) returns a list of aweme_id strings which keeps
    compatibility with `main.py`. If raw=True returns the raw `aweme_list`
    (list of dicts) as returned by the mobile API.

    The `headless` parameter is accepted for compatibility but not used.
    """
    try:
        # Build params and URL (may use cookie to help token extraction)
        params, url = build_params_and_url(sec_uid, cookie=cookie, count=count)

        # Debug: print the final URL so caller can inspect it
        _debug(f"[mdouyin] final_url: {url}")

        # Perform the request and parse JSON
        resp = send_request(url, cookie=cookie)
        try:
            data = resp.json()
        except Exception as e_json:
            _debug(f"[mdouyin] Warning: failed to parse JSON from mobile API response: {e_json}")
            data = {}

        # mobile API commonly returns an `aweme_list` array
        aweme_list = []
        if isinstance(data, dict):
            aweme_list = data.get("aweme_list") or data.get("data") or []

        # If caller wants raw items, return them
        if raw:
            return aweme_list or []

        # Otherwise, extract and return ids
        ids: List[str] = []
        for a in aweme_list or []:
            if not isinstance(a, dict):
                continue
            aid = a.get("aweme_id") or a.get("id") or a.get("awemeId")
            if aid:
                ids.append(str(aid))
        return ids
    except Exception as e:
        # Print exception so main.py (caller) can see why mdouyin failed
        import traceback

        print(f"[mdouyin] Error fetching recent aweme ids for {sec_uid}: {e}", file=sys.stderr)
        traceback.print_exc()
        # If a response dump was saved earlier, inform the user
        try:
            if os.path.exists("response.txt"):
                _debug("[mdouyin] Note: raw HTML saved to response.txt for debugging (look for xsstoken/webId)")
        except Exception:
            pass
        return []


def send_request(url: str, user_agent: Optional[str] = None, timeout: int = 30, cookie: Optional[Union[str, Dict[str, str]]] = None) -> requests.Response:
    """Send GET request to url using optional user_agent and cookie.

    cookie may be either a raw Cookie header string or a dict of cookie name->value.
    """
    if not user_agent:
        user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    headers = {
        "User-Agent": user_agent,
        "Referer": "https://m.douyin.com/",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Accept": "application/json, text/plain, */*",
    }

    # If cookie is provided as a raw header string, inject into headers.
    # If cookie is a dict, pass via requests' cookies parameter.
    req_kwargs: Dict[str, Any] = {"headers": headers, "timeout": timeout}
    if cookie:
        if isinstance(cookie, dict):
            req_kwargs["cookies"] = cookie
        else:
            # assume raw cookie header string
            headers["cookie"] = cookie

    resp = requests.get(url, **req_kwargs)
    resp.raise_for_status()
    return resp


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Douyin mobile API client (single-file)")
    p.add_argument("--sec-uid", required=True, help="Target user's sec_uid")
    p.add_argument("--cookie", default=None, help="Optional cookie string to improve token extraction")
    p.add_argument("--cookie-file", default=None, help="Read cookie string from a file; if omitted, auto-detect mcookie.txt/cookies.txt/cookie.txt in script folder")
    p.add_argument("--dry-run", action="store_true", help="Print final URL and exit without sending the request")
    p.add_argument("--save", default=None, help="Where to save the full response body (JSON pretty if JSON, else raw text). If omitted, response is not saved to disk.")
    p.add_argument("--output-json", default=None, help="Write the parsed JSON response body to this file (pretty-printed).")
    p.add_argument("--cookie-domain", action="append", default=[".douyin.com", "m.douyin.com"], help="Domains to include when parsing Netscape cookie file (can be repeated)")
    p.add_argument("--verbose", action="store_true", help="Print diagnostic logs (suppressed by default so stdout only has the response body)")
    args = p.parse_args(argv)

    _set_verbose(args.verbose)

    try:
        # Determine cookie precedence: --cookie > --cookie-file (if exists) > auto-detected > None
        cookie_value: Optional[str] = args.cookie
        cookie_path: Optional[str] = None

        # Resolve a cookie file path if needed
        if cookie_value is None:
            if args.cookie_file:
                cookie_path = _resolve_path(args.cookie_file)
            else:
                # Auto-detect common filenames in the script directory
                    for candidate in ("mcookie.txt", "cookies.txt", "cookie.txt"):
                        cand = _resolve_path(candidate)
                        exists = os.path.isfile(cand)
                        _debug(f"[mdouyin] checking candidate cookie file: {cand} exists={exists}")
                        if exists:
                            cookie_path = cand
                            _debug(f"[mdouyin] Auto-detected cookie file: {cookie_path}")
                            break

        if cookie_value is None and cookie_path is not None:
            try:
                _debug(f"[mdouyin] resolved cookie_path={cookie_path}, reading...")
                if os.path.isfile(cookie_path):
                    # Try parse as Netscape format first; if fails, treat file as raw header string
                    parsed = parse_netscape_cookie_file(cookie_path, target_domains=args.cookie_domain)
                    if parsed:
                        cookie_value = parsed
                        _debug(f"[mdouyin] Loaded {len(cookie_value)}-char Cookie header from Netscape file {cookie_path}")
                    else:
                        with open(cookie_path, "r", encoding="utf-8") as f:
                            content = f.read().strip()
                            if content:
                                cookie_value = content
                                _debug(f"[mdouyin] Loaded raw cookie from {cookie_path} ({len(content)} chars)")
            except Exception as e:
                print(f"Warning: could not read cookie file {cookie_path}: {e}", file=sys.stderr)

        # No legacy fallback; cookie must come from --cookie or --cookie-file

        params, final_url = build_params_and_url(args.sec_uid, cookie=cookie_value)
        _debug("Final URL:\n" + final_url + "\n")
        if args.dry_run:
            print("Dry-run: not sending the request.", file=sys.stderr)
            return 0

        resp = send_request(final_url, cookie=cookie_value)

        # Print only the response body (JSON pretty if possible). No status/headers.
        parsed_json: Optional[Any] = None
        try:
            parsed_json = resp.json()
        except Exception:
            parsed_json = None

        if parsed_json is not None:
            body = json.dumps(parsed_json, ensure_ascii=False, indent=2)
        else:
            body = resp.text

        print(body)

        # Save response if requested
        if args.save:
            try:
                with open(args.save, "w", encoding="utf-8") as f:
                    f.write(body)
                print(f"Saved response to {args.save}", file=sys.stderr)
            except Exception as e:
                print(f"Failed to save response to {args.save}: {e}", file=sys.stderr)

        if args.output_json:
            if parsed_json is None:
                print(
                    f"Cannot write JSON to {args.output_json} because the response was not valid JSON.",
                    file=sys.stderr,
                )
            else:
                try:
                    with open(args.output_json, "w", encoding="utf-8") as f:
                        json.dump(parsed_json, f, ensure_ascii=False, indent=2)
                    print(f"JSON response body written to {args.output_json}", file=sys.stderr)
                except Exception as e:
                    print(f"Failed to write JSON response to {args.output_json}: {e}", file=sys.stderr)

        return 0
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
