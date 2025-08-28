"use client";

import React from "react";

export type UploadedVideoContextValue = {
  file: File | null;
  setFile: (file: File | null) => void;
  objectUrl: string | null;
  clear: () => void;
};

export const UploadedVideoContext = React.createContext<UploadedVideoContextValue | null>(
  null
);

export function UploadedVideoProvider({ children }: { children: React.ReactNode }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!file) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file, objectUrl]);

  const clear = React.useCallback(() => setFile(null), []);

  return (
    <UploadedVideoContext.Provider value={{ file, setFile, objectUrl, clear }}>
      {children}
    </UploadedVideoContext.Provider>
  );
}

export function useUploadedVideo() {
  const ctx = React.useContext(UploadedVideoContext);
  if (!ctx) throw new Error("useUploadedVideo must be used within UploadedVideoProvider");
  return ctx;
}


