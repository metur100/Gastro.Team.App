import { z } from 'zod'
import { todayString } from '@/lib/format'

export const leaveRequestSchema = z
  .object({
    type: z.enum(['Vacation', 'Sick', 'Unpaid', 'Training', 'Other']),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Startdatum wählen.'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Enddatum wählen.'),
    note: z.string().max(500, 'Höchstens 500 Zeichen.'),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'Das Enddatum muss am oder nach dem Startdatum liegen.', path: ['endDate'] })
  .refine((v) => v.type === 'Sick' || v.startDate >= todayString(), { message: 'Urlaub kann nicht rückwirkend beantragt werden.', path: ['startDate'] })
