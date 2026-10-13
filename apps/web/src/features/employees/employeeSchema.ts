import { z } from 'zod'

const optionalDate = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ungültiges Datum.')])

export const employeeSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Bitte geben Sie einen Vornamen an.').max(100),
    lastName: z.string().trim().min(1, 'Bitte geben Sie einen Nachnamen an.').max(100),
    email: z.union([z.literal(''), z.email('Bitte geben Sie eine gültige E-Mail-Adresse an.')]),
    phone: z.string().max(40).regex(/^[0-9 +()/-]*$/, 'Die Telefonnummer enthält ungültige Zeichen.'),
    jobRoleId: z.string(),
    contractHoursPerWeek: z.string().regex(/^(\d{1,2}([.,]\d{1,2})?)?$/, 'Bitte eine Zahl zwischen 0 und 60 angeben.'),
    employmentStartDate: optionalDate,
    employmentEndDate: optionalDate,
    preferredLanguage: z.string(),
    locationIds: z.array(z.string()).min(1, 'Bitte ordnen Sie mindestens einen Standort zu.'),
    notes: z.string().max(1000, 'Höchstens 1000 Zeichen.'),
    sendInvitation: z.boolean(),
  })
  .refine((v) => !v.sendInvitation || v.email !== '', { message: 'Für eine Einladung wird eine E-Mail-Adresse benötigt.', path: ['email'] })
  .refine((v) => !v.contractHoursPerWeek || Number(v.contractHoursPerWeek.replace(',', '.')) <= 60, {
    message: 'Bitte eine Zahl zwischen 0 und 60 angeben.',
    path: ['contractHoursPerWeek'],
  })
  .refine((v) => !v.employmentStartDate || !v.employmentEndDate || v.employmentEndDate >= v.employmentStartDate, {
    message: 'Das Austrittsdatum muss nach dem Eintrittsdatum liegen.',
    path: ['employmentEndDate'],
  })

export type EmployeeFormValues = z.infer<typeof employeeSchema>

export function toRequest(v: EmployeeFormValues) {
  return {
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    email: v.email.trim() || null,
    phone: v.phone.trim() || null,
    jobRoleId: v.jobRoleId || null,
    contractHoursPerWeek: v.contractHoursPerWeek ? Number(v.contractHoursPerWeek.replace(',', '.')) : null,
    employmentStartDate: v.employmentStartDate || null,
    employmentEndDate: v.employmentEndDate || null,
    preferredLanguage: v.preferredLanguage || 'de-DE',
    locationIds: v.locationIds,
    notes: v.notes.trim() || null,
    sendInvitation: v.sendInvitation,
  }
}
