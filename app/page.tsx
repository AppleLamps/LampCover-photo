"use client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { useUploadedVideo } from "./providers";

export default function Home() {
  const router = useRouter();
  const { setFile } = useUploadedVideo();

  function onSelectFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== "video/mp4") {
      alert("Please upload an MP4 file.");
      return;
    }
    setFile(f);
    router.push("/editor");
  }

  return (
    <div className="min-h-dvh w-full flex items-center justify-center p-6">
      <div className="max-w-xl w-full">
        <Card>
          <CardHeader>
            <CardTitle>Upload your MP4</CardTitle>
            <CardDescription>
              Select a video to choose a cover photo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label
              htmlFor="file"
              className="block w-full cursor-pointer rounded-lg border border-dashed border-foreground/30 p-8 text-center hover:bg-foreground/5"
            >
              <div className="mb-3 text-sm text-foreground/80">
                Drag and drop or click to upload
              </div>
              <Input
                id="file"
                type="file"
                accept=".mp4,video/mp4"
                className="hidden"
                onChange={onSelectFile}
              />
              <div className="text-xs text-foreground/60">Only .mp4 files</div>
            </label>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
