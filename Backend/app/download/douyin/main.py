# pyright: reportUnknownParameterType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false, reportMissingParameterType=false, reportUnknownLambdaType=false
import argparse
import concurrent.futures as futures
import json
import os
import re
import sys
import time
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from urllib.parse import urlparse

# Modules in this workspace
import douyin as dy
import video as vdetail
import mdouyin as mdy


def parse_url(url: str) -> Tuple[str, str]:
	"""
	Phân loại URL Douyin và trích xuất id chính.
	Trả về tuple (kind, id):
	- kind == "user"  => id là sec_uid
	- kind == "video" => id là aweme_id
	Nếu không hợp lệ sẽ raise ValueError.
	"""
	u = urlparse(url)
	path = u.path.rstrip("/")

	# Ví dụ: https://www.douyin.com/video/7562196364742970678
	m = re.search(r"/video/(\d+)$", path)
	if m:
		return "video", m.group(1)

	# Ví dụ: https://www.douyin.com/user/MS4wLjABAAA...
	m = re.search(r"/user/([^/?#]+)$", path)
	if m:
		return "user", m.group(1)

	raise ValueError("URL không thuộc định dạng user hay video của Douyin")


def to_created_str(ts: int) -> str:
	return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts)) if ts else ""


def best_play_from_aweme_detail(aweme_detail):
	"""Chọn URL phát tốt nhất từ cấu trúc aweme_detail (API detail)."""
	video = (aweme_detail or {}).get("video") or {}
	# ưu tiên play_addr.bit_rate như bên douyin.py, nếu không có thì lấy play_addr.url_list[0]
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


def fetch_mobile_aweme_ids(sec_uid: str, count: int = 30, cookie: Optional[str] = None) -> List[str]:
	"""Proxy sang mdouyin.get_recent_aweme_ids để đảm bảo dùng đúng logic mobile."""
	try:
		return mdy.get_recent_aweme_ids(sec_uid, count, cookie=cookie)
	except Exception:
		return []


def get_video_detail_unified(aweme_id: str) -> Dict[str, Any]:
	# Ủy quyền cho hàm chuẩn hoá trong video.py để đồng nhất cấu trúc
	return vdetail.get_aweme_detail_unified(aweme_id)  # type: ignore


def handle_user_url(
	sec_uid: str,
	need_items: int = 60,
	recent_count: int = 30,
	source: str = "both",
	headless: bool = True,
	cookie: Optional[str] = None,
) -> Dict[str, Any]:
	"""
	Quy trình cho URL user:
	- Gọi douyin.scan_pc_awemes để lấy danh sách video (có thể thiếu video mới nhất)
	- Gọi mobile API (tương đương mdouyin) để lấy các aweme_id mới nhất
	- So sánh, chỉ gọi detail cho các aweme_id KHÔNG có trong kết quả từ douyin.py
	- Gộp kết quả và trả về JSON.
	"""
	source_norm = (source or "both").lower()
	if source_norm in ("both", "b"):
		with futures.ThreadPoolExecutor(max_workers=2) as ex:
			f1 = ex.submit(dy.scan_pc_awemes, sec_uid, 20, need_items)
			f2 = ex.submit(
				lambda: mdy.get_recent_aweme_ids(
					sec_uid,
					recent_count,
					cookie=cookie,
					headless=headless,
				)
			)
			dy_items = f1.result()
			mobile_ids = set(f2.result() or [])
	elif source_norm in ("m", "mobile"):
		dy_items = []
		mobile_ids = set(
			mdy.get_recent_aweme_ids(
				sec_uid,
				recent_count,
				cookie=cookie,
				headless=headless,
			)
			or []
		)
	else:  # pc only
		dy_items = dy.scan_pc_awemes(sec_uid, 20, need_items)
		mobile_ids = set()

	have_ids: Set[str] = {x.get("aweme_id") for x in dy_items if x.get("aweme_id")}
	new_ids = [aid for aid in mobile_ids if aid not in have_ids]

	# Lấy chi tiết cho các video mới (song song)
	new_details: List[Dict[str, Any]] = []
	if new_ids:
		with futures.ThreadPoolExecutor(max_workers=4) as ex:
			for d in ex.map(lambda vid: safe_get_detail(vid), new_ids):
				if d:
					new_details.append(d)

	combined = list(dy_items) + new_details

	# Nickname ưu tiên từ dy_items; nếu chạy mobile-only, lấy từ detail đầu tiên nếu có
	nickname = dy_items[0]["author"] if dy_items else (new_details[0]["author"] if new_details else "")
	user_info: Dict[str, Any] = {
		"sec_uid": sec_uid,
		"nickname": nickname,
		"total_videos": len(combined),
		"new_videos_added": len(new_details),
		"source": source_norm,
	}

	return {
		"user": user_info,
		"videos": combined,
	}


def safe_get_detail(aweme_id: str) -> Optional[Dict[str, Any]]:
	try:
		return get_video_detail_unified(aweme_id)
	except Exception:
		return None


def handle_video_url(aweme_id: str) -> Dict[str, Any]:
	d = get_video_detail_unified(aweme_id)
	return {"video": d}


def _runtime_search_dirs() -> Iterable[str]:
        cwd = os.getcwd()
        if cwd:
                yield cwd

        module_dir = os.path.dirname(os.path.abspath(__file__))
        if module_dir:
                yield module_dir

        if getattr(sys, "frozen", False):  # PyInstaller/py2exe
                exe_dir = os.path.dirname(os.path.abspath(sys.executable))
                if exe_dir:
                        yield exe_dir
                meipass = getattr(sys, "_MEIPASS", "")
                if meipass:
                        yield meipass


def _resolve_path(p: str) -> str:
        if os.path.isabs(p):
                return p

        candidates = [os.path.abspath(os.path.join(d, p)) for d in _runtime_search_dirs()]
        for cand in candidates:
                if os.path.exists(cand):
                        return cand

        return candidates[0] if candidates else os.path.abspath(p)


def _load_cookie_from_file(path: str, domains: Sequence[str]) -> Optional[str]:
	resolved = _resolve_path(path)
	if not os.path.isfile(resolved):
		return None

	parsed = mdy.parse_netscape_cookie_file(resolved, target_domains=list(domains) or None)
	if parsed:
		return parsed

	try:
		with open(resolved, "r", encoding="utf-8") as f:
			content = f.read().strip()
			return content or None
	except Exception:
		return None


def determine_cookie(
	explicit_cookie: Optional[str],
	cookie_file: Optional[str],
	cookie_domains: Sequence[str],
	auto_candidates: Sequence[str],
) -> Optional[str]:
	if explicit_cookie:
		return explicit_cookie

	search_paths: List[str] = []
	if cookie_file:
		search_paths.append(cookie_file)
	else:
		base = os.path.dirname(os.path.abspath(__file__))
		for cand in auto_candidates:
			search_paths.append(os.path.join(base, cand))

	for path in search_paths:
		cookie = _load_cookie_from_file(path, cookie_domains)
		if cookie:
			return cookie

	return None


def main():
	parser = argparse.ArgumentParser(description="Orchestrator: Douyin user/video handler")
	parser.add_argument("--url", "-u", required=True, help="Link Douyin: user hoặc video")
	parser.add_argument("--need-items", type=int, default=60, help="Số video tối đa lấy từ douyin.py")
	parser.add_argument("--recent-count", type=int, default=30, help="Số video mới (aweme_id) lấy từ mobile (mdouyin)")
	parser.add_argument(
		"--source",
		choices=["both", "m", "pc", "mobile", "b"],
		default="both",
		help="Nguồn dữ liệu: both (m+pc), m (mobile-only), pc (pc-only)"
	)
	parser.add_argument(
		"--headful",
		action="store_true",
		help="Mở trình duyệt Playwright ở chế độ hiển thị (mặc định headless)"
	)
	parser.add_argument("--cookie", default=None, help="Cookie header để truyền trực tiếp tới mdouyin")
	parser.add_argument(
		"--cookie-file",
		default=None,
		help="Đường dẫn file cookie (Netscape hoặc raw). Nếu bỏ trống sẽ tự tìm cookies.txt",
	)
	parser.add_argument(
		"--cookie-domain",
		action="append",
		default=[".douyin.com", "m.douyin.com"],
		help="Tên miền dùng lọc cookie khi đọc file định dạng Netscape (có thể lặp lại)",
	)
	parser.add_argument(
		"--cookie-candidate",
		action="append",
		default=["mcookie.txt", "cookies.txt", "cookie.txt"],
		help="Tên file cookie tự dò khi không truyền --cookie hoặc --cookie-file",
	)
	parser.add_argument(
		"--output-json",
		default=None,
		help="Nếu được cung cấp, ghi JSON kết quả ra file này (UTF-8, pretty).",
	)
	parser.add_argument(
		"--quiet",
		action="store_true",
		help="Không ghi JSON ra stdout (chỉ dùng khi kết hợp với --output-json).",
	)
	args = parser.parse_args()

	cookie_header = determine_cookie(
		args.cookie,
		args.cookie_file,
		args.cookie_domain,
		args.cookie_candidate,
	)

	kind, ident = parse_url(args.url)
	if kind == "user":
		out = handle_user_url(
			ident,
			need_items=args.need_items,
			recent_count=args.recent_count,
			source=args.source,
			headless=(not args.headful),
			cookie=cookie_header,
		)
	else:  # video
		out = handle_video_url(ident)

	if not args.quiet:
		print(json.dumps(out, ensure_ascii=False, indent=2))

	if args.output_json:
		try:
			path = _resolve_path(args.output_json)
			dir_name = os.path.dirname(path)
			if dir_name and not os.path.exists(dir_name):
				os.makedirs(dir_name, exist_ok=True)
			with open(path, "w", encoding="utf-8") as f:
				json.dump(out, f, ensure_ascii=False, indent=2)
				f.write("\n")
			print(f"JSON response body written to {path}", file=sys.stderr)
		except Exception as e:
			print(f"Failed to write JSON response to {args.output_json}: {e}", file=sys.stderr)


if __name__ == "__main__":
	main()

