import { Router, type Request, type Response } from 'express'
import {
  createUser,
  getUserByUsername,
  getActors,
  getActorById,
  createActor,
  updateActor,
  deleteActor,
  getPlaybills,
  getPlaybillById,
  createPlaybill,
  updatePlaybill,
  deletePlaybill,
  getRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  getSchedules,
  getScheduleById,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  getPerformanceLogs,
  getPerformanceLogById,
  createPerformanceLog,
  updatePerformanceLog,
  deletePerformanceLog,
  getWeekPosterData,
  type Actor,
  type Playbill,
  type Role,
  type Schedule,
  type PerformanceLog
} from './database.js'

const router = Router()

function handleError(res: Response, error: unknown): void {
  console.error(error)
  if (error instanceof Error) {
    res.status(400).json({
      success: false,
      error: error.message
    })
  } else {
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    })
  }
}

router.post('/auth/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: '用户名和密码不能为空'
      })
      return
    }

    const existingUser = getUserByUsername(username)
    if (existingUser) {
      res.status(400).json({
        success: false,
        error: '用户名已存在'
      })
      return
    }

    const user = createUser(username, password)

    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt
      }
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/auth/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: '用户名和密码不能为空'
      })
      return
    }

    const user = getUserByUsername(username)
    if (!user) {
      res.status(401).json({
        success: false,
        error: '用户名或密码错误'
      })
      return
    }

    if (user.password !== password) {
      res.status(401).json({
        success: false,
        error: '用户名或密码错误'
      })
      return
    }

    res.status(200).json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt
      }
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.get('/actors', async (req: Request, res: Response): Promise<void> => {
  try {
    const actors = getActors()
    res.status(200).json({
      success: true,
      data: actors
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/actors', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = req.body as Omit<Actor, 'id' | 'createdAt'>

    if (!data.name || !data.mainRole) {
      res.status(400).json({
        success: false,
        error: '演员名称和主攻行当不能为空'
      })
      return
    }

    const actor = createActor(data)
    res.status(201).json({
      success: true,
      data: actor
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.put('/actors/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const data = req.body as Partial<Omit<Actor, 'id' | 'createdAt'>>

    const existing = getActorById(id)
    if (!existing) {
      res.status(404).json({
        success: false,
        error: '演员不存在'
      })
      return
    }

    const actor = updateActor(id, data)
    res.status(200).json({
      success: true,
      data: actor
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.delete('/actors/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params

    const existing = getActorById(id)
    if (!existing) {
      res.status(404).json({
        success: false,
        error: '演员不存在'
      })
      return
    }

    const deleted = deleteActor(id)
    res.status(200).json({
      success: true,
      data: deleted
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.get('/playbills', async (req: Request, res: Response): Promise<void> => {
  try {
    const playbills = getPlaybills()
    res.status(200).json({
      success: true,
      data: playbills
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/playbills', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = req.body as Omit<Playbill, 'id' | 'createdAt'>

    if (!data.title) {
      res.status(400).json({
        success: false,
        error: '剧目名称不能为空'
      })
      return
    }

    const playbill = createPlaybill(data)
    res.status(201).json({
      success: true,
      data: playbill
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.put('/playbills/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const data = req.body as Partial<Omit<Playbill, 'id' | 'createdAt'>>

    const existing = getPlaybillById(id)
    if (!existing) {
      res.status(404).json({
        success: false,
        error: '剧目不存在'
      })
      return
    }

    const playbill = updatePlaybill(id, data)
    res.status(200).json({
      success: true,
      data: playbill
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.delete('/playbills/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params

    const existing = getPlaybillById(id)
    if (!existing) {
      res.status(404).json({
        success: false,
        error: '剧目不存在'
      })
      return
    }

    const deleted = deletePlaybill(id)
    res.status(200).json({
      success: true,
      data: deleted
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.get('/roles', async (req: Request, res: Response): Promise<void> => {
  try {
    const roles = getRoles()
    res.status(200).json({
      success: true,
      data: roles
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/roles', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = req.body as Omit<Role, 'id' | 'createdAt'>

    if (!data.playbillId || !data.name || !data.characterType) {
      res.status(400).json({
        success: false,
        error: '剧目ID、角色名称和行当类型不能为空'
      })
      return
    }

    const role = createRole(data)
    res.status(201).json({
      success: true,
      data: role
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.put('/roles/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const data = req.body as Partial<Omit<Role, 'id' | 'createdAt'>>

    const existing = getRoleById(id)
    if (!existing) {
      res.status(404).json({
        success: false,
        error: '角色不存在'
      })
      return
    }

    const role = updateRole(id, data)
    res.status(200).json({
      success: true,
      data: role
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.delete('/roles/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params

    const existing = getRoleById(id)
    if (!existing) {
      res.status(404).json({
        success: false,
        error: '角色不存在'
      })
      return
    }

    const deleted = deleteRole(id)
    res.status(200).json({
      success: true,
      data: deleted
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.get('/schedules', async (req: Request, res: Response): Promise<void> => {
  try {
    const schedules = getSchedules()
    res.status(200).json({
      success: true,
      data: schedules
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/schedules', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = req.body as Omit<Schedule, 'id' | 'createdAt'>

    if (!data.date || !data.playbillId) {
      res.status(400).json({
        success: false,
        error: '演出日期和剧目ID不能为空'
      })
      return
    }

    const schedule = createSchedule(data)
    res.status(201).json({
      success: true,
      data: schedule
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.put('/schedules/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const data = req.body as Partial<Omit<Schedule, 'id' | 'createdAt'>>

    const existing = getScheduleById(id)
    if (!existing) {
      res.status(404).json({
        success: false,
        error: '演出安排不存在'
      })
      return
    }

    const schedule = updateSchedule(id, data)
    res.status(200).json({
      success: true,
      data: schedule
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.delete('/schedules/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params

    const existing = getScheduleById(id)
    if (!existing) {
      res.status(404).json({
        success: false,
        error: '演出安排不存在'
      })
      return
    }

    const deleted = deleteSchedule(id)
    res.status(200).json({
      success: true,
      data: deleted
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.get('/logs', async (req: Request, res: Response): Promise<void> => {
  try {
    const logs = getPerformanceLogs()
    res.status(200).json({
      success: true,
      data: logs
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/logs', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = req.body as Omit<PerformanceLog, 'id' | 'createdAt'>

    if (!data.date || !data.playbillId) {
      res.status(400).json({
        success: false,
        error: '演出日期和剧目ID不能为空'
      })
      return
    }

    const log = createPerformanceLog(data)
    res.status(201).json({
      success: true,
      data: log
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.put('/logs/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const data = req.body as Partial<Omit<PerformanceLog, 'id' | 'createdAt'>>

    const existing = getPerformanceLogById(id)
    if (!existing) {
      res.status(404).json({
        success: false,
        error: '表演日志不存在'
      })
      return
    }

    const log = updatePerformanceLog(id, data)
    res.status(200).json({
      success: true,
      data: log
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.delete('/logs/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params

    const existing = getPerformanceLogById(id)
    if (!existing) {
      res.status(404).json({
        success: false,
        error: '表演日志不存在'
      })
      return
    }

    const deleted = deletePerformanceLog(id)
    res.status(200).json({
      success: true,
      data: deleted
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.get('/poster/week', async (req: Request, res: Response): Promise<void> => {
  try {
    const posterData = getWeekPosterData()
    res.status(200).json({
      success: true,
      data: posterData
    })
  } catch (error) {
    handleError(res, error)
  }
})

export default router
