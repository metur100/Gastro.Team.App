import { z } from 'zod'

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Bitte geben Sie Ihren Vornamen an.').max(100),
    lastName: z.string().trim().min(1, 'Bitte geben Sie Ihren Nachnamen an.').max(100),
    email: z.email('Bitte geben Sie eine gültige E-Mail-Adresse an.'),
    password: z.string().min(10, 'Das Passwort muss mindestens 10 Zeichen lang sein.').max(128),
    passwordRepeat: z.string(),
    acceptTerms: z.boolean().refine((v) => v, 'Bitte akzeptieren Sie die Nutzungsbedingungen und die Datenschutzhinweise.'),
  })
  .refine((v) => v.password === v.passwordRepeat, { message: 'Die Passwörter stimmen nicht überein.', path: ['passwordRepeat'] })
