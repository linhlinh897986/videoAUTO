
import requests, base64, random, os, re, textwrap, shutil, tempfile
try:
    import playsound as _playsound  # optional, only used when play=True
except Exception:
    _playsound = None
try:
    from mutagen.mp3 import MP3
    from mutagen import MutagenError
except ImportError:
    MP3 = None
    MutagenError = None
from typing import List, Optional
from .constants import voices

API_BASE_URL = "https://api16-normal-v6.tiktokv.com/media/api/text/speech/invoke/"
USER_AGENT = "com.zhiliaoapp.musically/2022600030 (Linux; U; Android 7.1.2; es_ES; SM-G988N; Build/NRD90M;tt-ok/3.12.13.1)"


def tts(session_id: str,
        text_speaker: str = "en_us_002",
        req_text: str = "TikTok Text To Speech",
        filename: str = "voice.mp3",
        play: bool = False) -> dict:
    """Call TikTok TTS for a single piece of text and save to filename."""
    # Basic normalization like the original script
    req_text = (req_text
                .replace("+", "plus")
                .replace(" ", "+")
                .replace("&", "and")
                .replace("ä", "ae")
                .replace("ö", "oe")
                .replace("ü", "ue")
                .replace("ß", "ss"))

    r = requests.post(
        f"{API_BASE_URL}?text_speaker={text_speaker}&req_text={req_text}&speaker_map_type=0&aid=1233",
        headers={
            "User-Agent": USER_AGENT,
            "Cookie": f"sessionid={session_id}"
        }
    )

    j = r.json()
    if j.get("message") == "Couldn't load speech. Try again.":
        output_data = {"status": "Session ID is invalid", "status_code": 5}
        print(output_data)
        return output_data

    vstr = j["data"]["v_str"]
    msg = j["message"]
    scode = j["status_code"]
    log = j["extra"]["log_id"]
    dur = j["data"]["duration"]
    spkr = j["data"]["speaker"]

    b64d = base64.b64decode(vstr)
    with open(filename, "wb") as out:
        out.write(b64d)

    output_data = {
        "status": msg.capitalize(),
        "status_code": scode,
        "duration": dur,
        "speaker": spkr,
        "log": log,
        "file": filename,
    }

    print(output_data)

    if play is True and _playsound is not None:
        try:
            _playsound.playsound(filename)
        except Exception:
            # Ignore playback errors in server environments
            pass

    return output_data


def _sorted_alphanumeric(data: List[str]) -> List[str]:
    convert = lambda text: int(text) if text.isdigit() else text.lower()
    alphanum_key = lambda key: [convert(c) for c in re.split("([0-9]+)", key)]
    return sorted(data, key=alphanum_key)


def concat_mp3_chunks(chunks_dir: str, output_filename: str) -> None:
    """Concatenate all .mp3 chunks in a folder into a single output file."""
    files = [f for f in os.listdir(chunks_dir) if f.lower().endswith(".mp3")]
    with open(output_filename, "wb") as out:
        for item in _sorted_alphanumeric(files):
            with open(os.path.join(chunks_dir, item), "rb") as fh:
                out.write(fh.read())


def synthesize_long_text(session_id: str,
                         text_speaker: str,
                         text: str,
                         output_filename: str = "voice.mp3",
                         chunk_size: int = 200,
                         keep_chunks: bool = False,
                         play: bool = False) -> dict:
    """Split long text into chunks, synthesize each, concatenate into one MP3."""
    # Split text respecting max TikTok length used in the original (200)
    textlist = textwrap.wrap(text, width=chunk_size, break_long_words=True, break_on_hyphens=False)

    tmpdir = tempfile.mkdtemp(prefix="tts_chunks_")
    try:
        # Generate chunks
        for i, segment in enumerate(textlist):
            tts(session_id, text_speaker, segment, os.path.join(tmpdir, f"{i}.mp3"), False)

        # Concatenate
        concat_mp3_chunks(tmpdir, output_filename)

        # Calculate duration of the final MP3 file
        duration_ms = 0
        if MP3 is not None and os.path.exists(output_filename):
            # Build exception tuple dynamically
            exceptions_to_catch = (OSError, AttributeError)
            if MutagenError is not None:
                exceptions_to_catch = (OSError, AttributeError, MutagenError)
            
            try:
                audio = MP3(output_filename)
                duration_ms = int(audio.info.length * 1000)  # Convert seconds to milliseconds
            except exceptions_to_catch as e:
                print(f"Warning: Could not read MP3 duration: {e}")
                duration_ms = 0

        # Optional playback
        if play and _playsound is not None:
            try:
                _playsound.playsound(output_filename)
            except Exception:
                pass

        result = {
            "status": "Ok",
            "status_code": 0,
            "chunks": len(textlist),
            "speaker": text_speaker,
            "file": output_filename,
            "duration": duration_ms,  # Add duration in milliseconds
        }
        print(result)
        return result
    finally:
        if not keep_chunks and os.path.isdir(tmpdir):
            shutil.rmtree(tmpdir, ignore_errors=True)


def random_voice() -> str:
    """Return a random voice from constants.voices (fix off-by-one)."""
    if not voices:
        raise ValueError("voices list is empty")
    idx = random.randint(0, len(voices) - 1)
    return voices[idx]


def sample_voices(session_id: str,
                  sample_text: str = "TikTok Text To Speech Sample",
                  out_dir: str = "samples") -> List[str]:
    """Render a short sample for each voice to out_dir and return file paths."""
    os.makedirs(out_dir, exist_ok=True)
    outputs = []
    for v in voices:
        out_file = os.path.join(out_dir, f"{v}.mp3")
        try:
            tts(session_id, v, sample_text, out_file, False)
            outputs.append(out_file)
        except Exception as e:
            print(f"Failed voice {v}: {e}")
    return outputs

