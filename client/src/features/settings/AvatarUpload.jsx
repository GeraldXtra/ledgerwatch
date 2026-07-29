import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import http from "../../api/http";
import { Avatar, Button, useToast } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const OUTPUT_SIZE = 512; // square, matching the avatar's object-fit: cover

/**
 * Square-crop and downscale in the browser before upload. A phone photo is
 * several MB; this lands around 60kB, which keeps the user document small and
 * stays far inside the server's 2MB decoded cap.
 */
function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not a readable image"));
      img.onload = () => {
        // Centre-crop to a square, then draw at OUTPUT_SIZE.
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;

        const canvas = document.createElement("canvas");
        canvas.width = OUTPUT_SIZE;
        canvas.height = OUTPUT_SIZE;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Profile picture control: click or drag to select, live preview, remove. */
export default function AvatarUpload() {
  const { user, applyUser } = useAuth();
  const toast = useToast();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file) {
    setError("");
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setError("Choose a JPEG, PNG or WebP image.");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await processImage(file);
      const { data } = await http.post("/api/auth/me/avatar", { dataUrl });
      applyUser(data.user);
      toast("Profile picture updated.", { type: "success" });
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const { data } = await http.delete("/api/auth/me/avatar");
      applyUser(data.user);
      toast("Profile picture removed.", { type: "success" });
    } catch (err) {
      setError(err?.response?.data?.error || "Could not remove the picture");
    } finally {
      setBusy(false);
    }
  }

  const pick = () => inputRef.current && inputRef.current.click();

  return (
    <div className="avatar-upload">
      <Avatar name={user.name} src={user.avatarUrl} size="xl" />

      <div className="grow">
        <div
          className={`avatar-drop${dragging ? " is-dragging" : ""}`}
          role="button"
          tabIndex={0}
          onClick={pick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              pick();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFile(e.dataTransfer.files && e.dataTransfer.files[0]);
          }}
        >
          <Upload size={16} />
          <span>
            <strong>Click to upload</strong> or drag an image here
          </span>
          <span className="muted small">JPEG, PNG or WebP — cropped to a square automatically</span>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          hidden
          onChange={(e) => handleFile(e.target.files && e.target.files[0])}
        />

        <div className="row" style={{ marginTop: 12 }}>
          <Button size="sm" disabled={busy} onClick={pick}>
            <Upload size={14} /> {busy ? "Uploading…" : "Choose image"}
          </Button>
          {user.avatarUrl && (
            <Button variant="danger" size="sm" disabled={busy} onClick={remove}>
              <Trash2 size={14} /> Remove
            </Button>
          )}
        </div>

        {error && (
          <p className="error-text" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
