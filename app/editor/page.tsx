"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { useUploadedVideo } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

function formatTime(seconds: number) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export default function EditorPage() {
  const router = useRouter();
  const { file, objectUrl } = useUploadedVideo();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [duration, setDuration] = React.useState(0);
  const [selectedTime, setSelectedTime] = React.useState(0);
  const [thumbDataUrl, setThumbDataUrl] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!file || !objectUrl) {
      router.replace("/");
    }
  }, [file, objectUrl, router]);

  function seekTo(time: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
  }

  function onLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration || 0);
    setSelectedTime(0);
    seekTo(0);
  }

  function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setThumbDataUrl(dataUrl);
  }

  React.useEffect(() => {
    // After each seeked event, update thumbnail
    const v = videoRef.current;
    if (!v) return;
    const onSeeked = () => captureFrame();
    v.addEventListener("seeked", onSeeked);
    return () => v.removeEventListener("seeked", onSeeked);
  }, []);

  function onScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const time = Number(e.target.value);
    setSelectedTime(time);
    seekTo(time);
  }

  async function onSubmit() {
    if (!file) return;
    setIsSubmitting(true);
    try {
      const form = new FormData();
      form.append("video", file);
      form.append("timestamp", String(selectedTime));
      const res = await fetch("/api/process", {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error("Processing failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "output.mp4";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to process video");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Editor</CardTitle>
          <CardDescription>Scrub to select a frame for the cover.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-2 space-y-4">
              {objectUrl && (
                <video
                  ref={videoRef}
                  src={objectUrl}
                  onLoadedMetadata={onLoadedMetadata}
                  controls={false}
                  className="w-full rounded-lg border border-foreground/15 bg-black"
                />
              )}
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.01}
                  value={selectedTime}
                  onChange={onScrub}
                  aria-label="Select timestamp"
                  className="w-full accent-foreground"
                />
                <div className="text-sm w-[72px] text-right tabular-nums">
                  {formatTime(selectedTime)}
                </div>
              </div>
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <div className="space-y-4">
              <div className="aspect-video w-full overflow-hidden rounded-lg border border-foreground/15 bg-foreground/5 flex items-center justify-center">
                {thumbDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbDataUrl} alt="Selected frame" className="w-full h-full object-contain" />
                ) : (
                  <div className="text-sm text-foreground/60">Frame preview</div>
                )}
              </div>
              <Button onClick={onSubmit} disabled={isSubmitting} className="w-full">
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-2"><Spinner /> Processing...</span>
                ) : (
                  "Set Cover Photo & Download"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


