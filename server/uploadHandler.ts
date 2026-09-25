import type { Request, Response, NextFunction } from 'express'
import multer, { type FileFilterCallback, type MulterError } from 'multer'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs'
import * as mm from 'music-metadata'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const tempDir = path.join(__dirname, '..', 'temp', 'uploads')

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true })
}

export interface UploadResponse {
  fileUrl: string
  duration: number
  sampleRate: number
  channels: number
}

interface AudioFile extends Express.Multer.File {
  path: string
}

const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    cb(null, tempDir)
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const fileExtension = path.extname(file.originalname).toLowerCase()
    const uniqueName = `${uuidv4()}${fileExtension}`
    cb(null, uniqueName)
  },
})

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void => {
  const allowedTypes = /mp3|wav/
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
  const mimetype = allowedTypes.test(file.mimetype)

  if (extname && mimetype) {
    cb(null, true)
  } else {
    cb(new Error('只支持 MP3 和 WAV 格式的音频文件'))
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
})

const uploadMiddleware = upload.single('audio')

const isMulterError = (err: unknown): err is MulterError => {
  return err instanceof Error && 'code' in err && 'message' in err
}

export const uploadHandler = (req: Request, res: Response, _next: NextFunction): void => {
  uploadMiddleware(req, res, async (err?: unknown) => {
    if (err) {
      if (isMulterError(err)) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({
            success: false,
            error: '文件大小超过限制，最大支持 50MB',
          })
          return
        }
        res.status(400).json({
          success: false,
          error: err.message,
        })
        return
      }
      if (err instanceof Error) {
        res.status(400).json({
          success: false,
          error: err.message,
        })
        return
      }
      res.status(500).json({
        success: false,
        error: '文件上传失败',
      })
      return
    }

    if (!req.file) {
      res.status(400).json({
        success: false,
        error: '请选择要上传的音频文件',
      })
      return
    }

    try {
      const audioFile = req.file as AudioFile
      const mmWithParseFile = mm as unknown as {
        parseFile: (path: string) => Promise<{
          format: {
            duration?: number
            sampleRate?: number
            numberOfChannels?: number
          }
        }>
      }
      const metadata = await mmWithParseFile.parseFile(audioFile.path)

      const baseUrl = `${req.protocol}://${req.get('host') ?? 'localhost:3001'}`
      const fileUrl = `${baseUrl}/temp/uploads/${path.basename(audioFile.path)}`

      const response: UploadResponse = {
        fileUrl,
        duration: metadata.format.duration ?? 0,
        sampleRate: metadata.format.sampleRate ?? 0,
        channels: metadata.format.numberOfChannels ?? 0,
      }

      res.status(200).json({
        success: true,
        data: response,
      })
    } catch {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path)
      }

      res.status(500).json({
        success: false,
        error: '音频文件解析失败',
      })
    }
  })
}

export default uploadHandler
