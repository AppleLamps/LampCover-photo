import { NextRequest } from 'next/server';
import { extractFrame, addCoverImage } from '@/lib/ffmpeg-secure';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Concurrent request limiting
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 3;

/**
 * Validates the content of a video file by checking its magic numbers.
 * @param buffer The file content as a Uint8Array.
 * @returns `true` if the file is a valid and supported video type, `false` otherwise.
 */
function isValidVideoFile(buffer: Uint8Array): boolean {
  // Helper to check for a sequence of bytes at a specific offset
  const bytesAt = (offset: number, sequence: number[]) => {
    if (buffer.length < offset + sequence.length) {
      return false;
    }
    return sequence.every((byte, i) => buffer[offset + i] === byte);
  };

  // Check for MP4/MOV magic numbers ('ftyp' at offset 4)
  // ISO Base Media File Format (covers .mp4, .mov, etc.)
  if (bytesAt(4, [0x66, 0x74, 0x79, 0x70])) { // 'ftyp'
    return true;
  }

  // Check for MPEG-PS (Program Stream) pack start code
  if (bytesAt(0, [0x00, 0x00, 0x01, 0xBA])) {
    return true;
  }

  // MPEG-TS (Transport Stream) starts with 0x47 (sync byte)
  // and should have it every 188 or 204 bytes. Checking the first byte is a good indicator.
  if (buffer.length > 0 && buffer[0] === 0x47) {
    return true;
  }

  return false;
}

export async function POST(req: NextRequest) {
  // Check concurrent request limit
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    return new Response('Server busy, please try again later', { status: 503 });
  }

  activeRequests++;

  try {
    const data = await req.formData();
    const video = data.get('video') as File | null;
    const timestampRaw = data.get('timestamp');

    if (!video) {
      return new Response('Missing file', { status: 400 });
    }

    // Enhanced timestamp validation to prevent command injection
    if (!timestampRaw || typeof timestampRaw !== 'string') {
      return new Response('Missing or invalid timestamp', { status: 400 });
    }

    // Strict numeric validation - only allow digits and decimal point
    if (!/^\d+(\.\d+)?$/.test(timestampRaw)) {
      return new Response('Invalid timestamp format', { status: 400 });
    }

    const ts = parseFloat(timestampRaw);

    // Validate timestamp range and ensure it's a finite number
    if (!Number.isFinite(ts) || ts < 0 || ts > 86400) { // Max 24 hours
      return new Response('Invalid timestamp range', { status: 400 });
    }

    const timestamp = ts;

  // --- Start of security validation ---
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  const ALLOWED_TYPES = ['video/mp4', 'video/mpeg', 'video/quicktime'];

  if (video.size > MAX_FILE_SIZE) {
    return new Response('File too large. Maximum size is 100MB.', { status: 413 });
  }

  if (!ALLOWED_TYPES.includes(video.type)) {
    return new Response(`Invalid file type. Allowed types are: ${ALLOWED_TYPES.join(', ')}`, { status: 400 });
  }

  const videoBuffer = Buffer.from(await video.arrayBuffer());

  if (!isValidVideoFile(videoBuffer)) {
    return new Response('Invalid or unsupported video file content.', { status: 400 });
  }
  // --- End of security validation ---

  // Enhanced filename validation and sanitization
  if (!video.name || typeof video.name !== 'string') {
    return new Response('Invalid filename', { status: 400 });
  }

  // Prevent path traversal attacks
  if (video.name.includes('..') || video.name.includes('/') || video.name.includes('\\')) {
    return new Response('Invalid filename - path traversal detected', { status: 400 });
  }

  // Strict filename sanitization - only allow safe characters
  const sanitizedFilename = video.name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 100) // Limit length
    .replace(/^\.+/, '') // Remove leading dots
    .replace(/\.+$/, '') // Remove trailing dots
    || 'video'; // Fallback if empty after sanitization

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cover-app-'));

  // Pick an input extension that matches the MIME type to help with tooling/logs
  const extFromType: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/mpeg': 'mpg',
  };
  const inputExt = extFromType[video.type] ?? 'mp4';

  // Generate secure file paths with additional validation
  const timestamp_safe = Date.now();
  const inputPath = path.join(tempDir, `input_${timestamp_safe}.${inputExt}`);
  const coverPath = path.join(tempDir, 'cover.jpg');
  const outputPath = path.join(tempDir, 'output.mp4');

  // Validate that all paths are within the temp directory (prevent path traversal)
  if (!inputPath.startsWith(tempDir) || !coverPath.startsWith(tempDir) || !outputPath.startsWith(tempDir)) {
    return new Response('Invalid file path detected', { status: 400 });
  }



  await fs.promises.writeFile(inputPath, videoBuffer);

  try {
      // Ensure timestamp is safe for FFmpeg (additional validation)
      const safeTimestamp = Math.max(0, Math.min(timestamp, 86400));

      // Extract cover image using secure wrapper
      await extractFrame({
        input: inputPath,
        output: coverPath,
        seekTime: safeTimestamp,
        frames: 1,
        quality: 2,
        timeout: 30000
      });

      // Add cover image to video using secure wrapper
      await addCoverImage({
        videoInput: inputPath,
        imageInput: coverPath,
        output: outputPath,
        timeout: 60000
      });

    const outputFileBuffer = await fs.promises.readFile(outputPath);

    // Secure filename handling for Content-Disposition header
    const base = path.parse(sanitizedFilename).name || 'output';
    const attachmentName = `${base}_with_cover.mp4`;

    // Prevent header injection by properly escaping the filename
    const safeAttachmentName = attachmentName
      .replace(/["\r\n]/g, '') // Remove quotes and newlines
      .substring(0, 100); // Limit length

    return new Response(outputFileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${safeAttachmentName}"`,
        'Content-Length': String(outputFileBuffer.length),
        'X-Content-Type-Options': 'nosniff', // Additional security header
      },
    });
    } catch (error) {
      console.error('FFmpeg processing error:', error);

      // Return appropriate error based on error type
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          return new Response("Processing timeout", { status: 408 });
        } else if (error.message.includes('Invalid')) {
          return new Response("Invalid video format", { status: 400 });
        } else if (error.message.includes('No such file')) {
          return new Response("File processing error", { status: 400 });
        } else {
          return new Response("Processing error", { status: 500 });
        }
      } else {
        return new Response("Processing error", { status: 500 });
      }
    } finally {
      // Ensure cleanup always happens
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }
    }
  } finally {
    // Always decrement active requests counter
    activeRequests--;
  }
}