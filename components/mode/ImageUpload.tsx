"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "./AuthProvider";

const MAX_BYTES = 5 * 1024 * 1024;

export function ImageUpload({
  label,
  value,
  onChange,
  folder,
  shape = "square",
}: {
  label: string;
  value?: string;
  onChange: (url: string) => void;
  folder: "logos" | "banners";
  shape?: "square" | "wide";
}) {
  const { session } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setError("Connect and sign in with a wallet first.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be under 5MB.");
      return;
    }
    setUploading(true);
    try {
      const extension = file.name.split(".").pop() || "png";
      const path = `${session.user.id}/${folder}/${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("project-media").upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("project-media").getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="image-upload">
      <label className={`upload-box image-upload-box ${shape}`}>
        {value ? (
          <img src={value} alt="" className="image-upload-preview" />
        ) : (
          <span>{uploading ? "Uploading…" : `Upload ${label}`}</span>
        )}
        <input
          type="file"
          accept="image/*"
          hidden
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = "";
          }}
        />
      </label>
      {error && <small className="image-upload-error">{error}</small>}
    </div>
  );
}
