# pyright: reportUnknownParameterType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false, reportMissingParameterType=false, reportMissingTypeStubs=false, reportUnknownLambdaType=false
import requests
import json
import sys
import time
from urllib.parse import urlencode

# --- PHẦN 1: CẤU HÌNH VÀ CÁC GIÁ TRỊ CỐ ĐỊNH ---

# ID video mục tiêu do bạn cung cấp
# Lưu ý: Tên tham số chính xác là 'aweme_id'
AWEME_ID = "7562196364742970678"

# User-Agent của một trình duyệt hiện đại. Giá trị này phải nhất quán
# với các tham số trình duyệt trong `base_params`.
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"

# Điểm cuối (endpoint) của dịch vụ mã nguồn mở để tạo chữ ký a_bogus.[1]
SIGNATURE_API_URL = "https://abogus.jackluson.workers.dev/"

# msToken và fp (verifyFp) là các mã thông báo nhận dạng.
# Để đơn giản, chúng ta sử dụng các giá trị tĩnh được trích xuất từ một yêu cầu
# hợp lệ trong trình duyệt (ví dụ: từ URL bạn đã cung cấp).
# Trong một hệ thống phức tạp hơn, các giá trị này sẽ được tạo động.
MS_TOKEN = "9Ua5NedayLG5cE9ZYa-pm3LnaQ9ZJdauOdYaCmt1ciaKdqJCYaxwZmDGYx79ylcTZ6CsyXUXIgjS3xB4hi65-2fjuFgfb4DcDadH4g8T5_mO4gz9QEzy27OQwLo1kZVvZrQ-Rw1ae4uratdLt8Q95zuEEE1hbR31YQg9VLTQuguI"
VERIFY_FP = "verify_mgep5fr4_613200a7_0556_7fcf_4af0_75cdeed734e2"


# --- PHẦN 2: CÁC HÀM TIỆN ÍCH ---

def get_ttwid():
    """
    Lấy cookie 'ttwid' bằng cách gửi yêu cầu đến điểm cuối của Bytedance.
    Đây là một bước quan trọng để xây dựng một ngữ cảnh cookie hợp lệ.[2]
    """
    url = "https://ttwid.bytedance.com/ttwid/union/register/"
    payload = {
        "region": "cn", "aid": 1768, "needFid": False,
        "service": "www.ixigua.com", "migrate_info": {"ticket": "", "source": "node"},
        "cbUrlProtocol": "https", "union": True
    }
    try:
        response = requests.post(url, json=payload)
        response.raise_for_status()
        # Trích xuất cookie 'ttwid' từ tiêu đề phản hồi
        ttwid_cookie = response.cookies.get('ttwid')
        if ttwid_cookie:
            return ttwid_cookie
        else:
            print("Lỗi: Không tìm thấy ttwid trong phản hồi cookie.", file=sys.stderr)
            return None
    except requests.exceptions.RequestException as e:
        print(f"Lỗi khi lấy ttwid: {e}", file=sys.stderr)
        return None

def get_a_bogus_signature(url_params_str, user_agent):
    """
    Gọi một dịch vụ bên ngoài để tạo chữ ký a_bogus.[1]
    """
    payload = {"url": url_params_str, "ua": user_agent}
    try:
        response = requests.post(SIGNATURE_API_URL, json=payload)
        response.raise_for_status()
        data = response.json()
        if data.get("code") == 0 and "res" in data and "abogus" in data["res"]:
            return data["res"]["abogus"]
        else:
            print(f"Lỗi API chữ ký: {data.get('message', 'Lỗi không xác định')}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"Không thể gọi API chữ ký: {e}")
        return None

def parse_and_display_info(data):
    """
    Phân tích cú pháp phản hồi JSON và hiển thị thông tin video quan trọng.[3, 4]
    """
    if not data or "aweme_detail" not in data:
        print("Dữ liệu không hợp lệ hoặc thiếu khóa 'aweme_detail'.")
        return

    aweme_detail = data["aweme_detail"]
    
    # Trích xuất thông tin cơ bản
    author = aweme_detail.get("author", {})
    video = aweme_detail.get("video", {})
    stats = aweme_detail.get("statistics", {})
    
    # Lấy các giá trị cụ thể
    author_nickname = author.get("nickname", "N/A")
    author_uid = author.get("uid", "N/A")
    description = aweme_detail.get("desc", "Không có mô tả")
    
    like_count = stats.get("digg_count", 0)
    comment_count = stats.get("comment_count", 0)
    share_count = stats.get("share_count", 0)
    collect_count = stats.get("collect_count", 0)
    
    # URL video không có hình mờ thường là mục đầu tiên trong danh sách
    video_urls = video.get("play_addr", {}).get("url_list",)
    no_watermark_url = video_urls if video_urls else "Không tìm thấy URL"
    
    # Hiển thị thông tin
    print("\n" + "="*50)
    print("            THÔNG TIN VIDEO DOUYIN")
    print("="*50)
    print(f"📝 Tác giả: {author_nickname} (UID: {author_uid})")
    print(f"📄 Mô tả: {description}")
    print("-" * 50)
    print(f"👍 Lượt thích: {like_count:,}")
    print(f"💬 Bình luận: {comment_count:,}")
    print(f"🔗 Lượt chia sẻ: {share_count:,}")
    print(f"⭐ Lượt lưu: {collect_count:,}")
    print("-" * 50)
    print(f"📹 URL Video (Không hình mờ):\n{no_watermark_url}")
    print("="*50)


# --- PHẦN BỔ SUNG: CHUẨN HÓA THÔNG TIN GIỐNG douyin.py ---

def _pick_best_play_from_detail(aweme_detail):
    video = (aweme_detail or {}).get("video") or {}
    br = video.get("bit_rate") or []
    cand = []
    for x in br:
        pa = (x.get("play_addr") or {})
        urls = pa.get("url_list") or []
        if urls:
            try:
                brv = int(x.get("bit_rate") or 0)
            except Exception:
                brv = 0
            cand.append((brv, urls[0]))
    if cand:
        cand.sort(key=lambda t: t[0], reverse=True)
        return cand[0][1]
    pa = (video.get("play_addr") or {})
    urls = pa.get("url_list") or []
    if urls:
        u = urls[0]
        return u.replace("playwm", "play") if "playwm" in u else u
    da = (video.get("download_addr") or {})
    urls = da.get("url_list") or []
    if urls:
        u = urls[0]
        return u.replace("playwm", "play") if "playwm" in u else u
    return None

def _pick_cover_from_detail(aweme_detail):
    video = (aweme_detail or {}).get("video") or {}
    for k in ("dynamic_cover", "cover", "origin_cover"):
        obj = video.get(k) or {}
        urls = obj.get("url_list") or []
        if urls:
            return urls[0]
    return None

def get_aweme_detail_unified(aweme_id: str):
    """
    Trả về dict cùng cấu trúc với output của douyin.scan_pc_awemes()
    có thêm trường 'cover'.
    """
    base_params = {
        "device_platform": "webapp", "aid": "6383", "channel": "channel_pc_web",
        "aweme_id": aweme_id, "update_version_code": "170400", "pc_client_type": "1",
        "version_code": "190500", "version_name": "19.5.0", "cookie_enabled": "true",
        "screen_width": "1920", "screen_height": "1080", "browser_language": "vi",
        "browser_platform": "Win32", "browser_name": "Chrome", "browser_version": "141.0.0.0",
        "os_name": "Windows", "os_version": "10", "msToken": MS_TOKEN, "fp": VERIFY_FP,
    }

    encoded = urlencode(base_params)
    a_bogus = get_a_bogus_signature(encoded, USER_AGENT)
    if not a_bogus:
        raise RuntimeError("Không thể tạo chữ ký a_bogus")

    params = dict(base_params)
    params["a_bogus"] = a_bogus
    final_url = f"https://www-hj.douyin.com/aweme/v1/web/aweme/detail/?{urlencode(params)}"

    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "vi-VN,vi;q=0.9",
        "Referer": f"https://www.douyin.com/video/{aweme_id}",
        "User-Agent": USER_AGENT,
    }
    cookies = {"msToken": MS_TOKEN}
    ttwid = get_ttwid()
    if ttwid:
        cookies["ttwid"] = ttwid

    r = requests.get(final_url, headers=headers, cookies=cookies, timeout=20)
    r.raise_for_status()
    data = r.json() or {}
    a = (data.get("aweme_detail") or {})

    ts = int(a.get("create_time") or 0)
    best = _pick_best_play_from_detail(a)
    cover = _pick_cover_from_detail(a)
    return {
        "aweme_id": a.get("aweme_id") or aweme_id,
        "desc": (a.get("desc") or "").strip(),
        "create_time": ts,
        "created": (time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts)) if ts else ""),
        "author": ((a.get("author") or {}) or {}).get("nickname", ""),
        "best_play": best,
        "cover": cover,
        "page_url": f"https://www.douyin.com/video/{aweme_id}",
    }


# --- PHẦN 3: HÀM CHÍNH ĐỂ THỰC THI ---

def main():
    """
    Hàm chính điều phối toàn bộ quá trình.
    """
    print(f"Bắt đầu lấy thông tin cho video ID: {AWEME_ID}")

    # Bước 1: Lấy ttwid
    ttwid = get_ttwid()
    if not ttwid:
        print("Không thể tiếp tục nếu không có ttwid. Đang thoát.")
        return

    # Bước 2: Xây dựng các tham số URL cơ bản (chưa có a_bogus)
    # Các tham số này mô phỏng một yêu cầu từ trình duyệt web trên máy tính.
    base_params = {
        "device_platform": "webapp", "aid": "6383", "channel": "channel_pc_web",
        "aweme_id": AWEME_ID, "update_version_code": "170400", "pc_client_type": "1",
        "version_code": "190500", "version_name": "19.5.0", "cookie_enabled": "true",
        "screen_width": "1920", "screen_height": "1080", "browser_language": "vi",
        "browser_platform": "Win32", "browser_name": "Chrome", "browser_version": "141.0.0.0",
        "os_name": "Windows", "os_version": "10", "msToken": MS_TOKEN, "fp": VERIFY_FP,
    }
    
    encoded_params = urlencode(base_params)
    
    # Bước 3: Lấy chữ ký a_bogus
    print("Đang tạo chữ ký a_bogus...")
    a_bogus = get_a_bogus_signature(encoded_params, USER_AGENT)
    
    if not a_bogus:
        print("Không thể tạo chữ ký a_bogus. Đang hủy bỏ.")
        return
        
    print("Đã tạo chữ ký thành công.")
    
    # Bước 4: Lắp ráp URL cuối cùng và các tiêu đề, cookie
    final_params = {**base_params, "a_bogus": a_bogus}
    final_url = f"https://www-hj.douyin.com/aweme/v1/web/aweme/detail/?{urlencode(final_params)}"
    
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "vi-VN,vi;q=0.9",
        "Referer": f"https://www.douyin.com/video/{AWEME_ID}",
        "User-Agent": USER_AGENT,
    }
    
    cookies = {
        "msToken": MS_TOKEN,
        "ttwid": ttwid,
    }
    
    # Bước 5: Thực thi yêu cầu cuối cùng
    print("Đang gửi yêu cầu đến API Douyin...")
    try:
        response = requests.get(final_url, headers=headers, cookies=cookies)
        response.raise_for_status()
        print("Yêu cầu thành công! Đang phân tích dữ liệu...")
        video_data = response.json()
        
        # Bước 6: Phân tích và hiển thị kết quả (hiển thị cũ)
        parse_and_display_info(video_data)

        # Bước 7: In thêm JSON chuẩn hoá giống douyin.py (bao gồm cover)
        try:
            unified = get_aweme_detail_unified(AWEME_ID)
            print("\n=== JSON (chuẩn hoá giống douyin.py) ===")
            print(json.dumps(unified, ensure_ascii=False, indent=2))
        except Exception as e:
            print(f"Không thể xuất JSON chuẩn hoá: {e}")
        
    except requests.exceptions.RequestException as e:
        print(f"Yêu cầu API Douyin thất bại: {e}")
        if e.response is not None:
            print(f"Mã trạng thái: {e.response.status_code}")
            print(f"Nội dung phản hồi: {e.response.text}")

if __name__ == "__main__":
    main()
