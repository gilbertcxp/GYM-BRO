import type {
  ChallengeType, ExperienceLevel, GoalStatus, GoalType, MainGoal, Mechanics, Modality,
  MuscleGroup, PhotoCategory, PrType, RoutineStatus, ScheduleStatus, SessionStatus, SetType,
} from './types'

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'Pecho', back: 'Espalda', shoulders: 'Hombros', biceps: 'Bíceps', triceps: 'Tríceps',
  forearms: 'Antebrazos', quads: 'Cuádriceps', hamstrings: 'Isquiotibiales', glutes: 'Glúteos',
  calves: 'Pantorrillas', abs: 'Abdominales',
}
export const MUSCLES = Object.keys(MUSCLE_LABELS) as MuscleGroup[]

export const MECHANICS_LABELS: Record<Mechanics, string> = { compound: 'Compuesto', isolation: 'Aislamiento' }
export const MODALITY_LABELS: Record<Modality, string> = {
  free_weight: 'Peso libre', machine: 'Máquina', cable: 'Poleas', bodyweight: 'Peso corporal',
}
export const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  beginner: 'Principiante', intermediate: 'Intermedio', advanced: 'Avanzado',
}
export const MAIN_GOAL_LABELS: Record<MainGoal, string> = {
  muscle_gain: 'Ganar masa muscular', fat_loss: 'Perder grasa', recomposition: 'Recomposición corporal', strength: 'Aumentar fuerza',
}
export const ROUTINE_STATUS_LABELS: Record<RoutineStatus, string> = { active: 'Activa', paused: 'Pausada', archived: 'Archivada' }
export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = { in_progress: 'En curso', completed: 'Completada', abandoned: 'Abandonada' }
export const SET_TYPE_LABELS: Record<SetType, string> = {
  warmup: 'Calentamiento', normal: 'Normal', failure: 'Al fallo', drop: 'Drop set', rest_pause: 'Rest-pause',
}
export const SET_TYPE_SHORT: Record<SetType, string> = { warmup: 'C', normal: '', failure: 'F', drop: 'D', rest_pause: 'RP' }
export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = { front: 'Frontal', side: 'Lateral', back: 'Espalda', other: 'Otra' }
export const PR_LABELS: Record<PrType, string> = {
  max_weight: 'Mayor peso', max_reps_at_weight: 'Más reps con un peso', est_1rm: '1RM estimado (Epley)', max_session_volume: 'Mayor volumen en sesión',
}
export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  body_weight: 'Peso corporal', strength: 'Fuerza por ejercicio', attendance: 'Asistencia semanal',
  volume: 'Volumen semanal', measurement: 'Medida corporal',
}
export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  pending: 'Pendiente', in_progress: 'En progreso', completed: 'Completado', paused: 'Pausado',
}
export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  scheduled: 'Programado', completed: 'Completado', skipped: 'Omitido', rest: 'Descanso',
}
export const CHALLENGE_TYPE_LABELS: Record<ChallengeType, string> = {
  weekly_workouts: 'Entrenamientos por semana', exercise_improvement: 'Mejorar un ejercicio (1RM estimado)',
  routine_consistency: 'Constancia con una rutina', monthly_attendance: 'Asistencia en el período',
}
export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export const MEASUREMENT_FIELDS = [
  { key: 'weight_kg', label: 'Peso corporal', unit: 'kg' },
  { key: 'height_cm', label: 'Estatura', unit: 'cm' },
  { key: 'waist_cm', label: 'Cintura', unit: 'cm' },
  { key: 'chest_cm', label: 'Pecho', unit: 'cm' },
  { key: 'hips_cm', label: 'Cadera', unit: 'cm' },
  { key: 'arm_left_cm', label: 'Brazo izquierdo', unit: 'cm' },
  { key: 'arm_right_cm', label: 'Brazo derecho', unit: 'cm' },
  { key: 'forearm_left_cm', label: 'Antebrazo izquierdo', unit: 'cm' },
  { key: 'forearm_right_cm', label: 'Antebrazo derecho', unit: 'cm' },
  { key: 'thigh_left_cm', label: 'Muslo izquierdo', unit: 'cm' },
  { key: 'thigh_right_cm', label: 'Muslo derecho', unit: 'cm' },
  { key: 'calf_left_cm', label: 'Pantorrilla izquierda', unit: 'cm' },
  { key: 'calf_right_cm', label: 'Pantorrilla derecha', unit: 'cm' },
  { key: 'body_fat_pct', label: '% grasa corporal', unit: '%' },
] as const
export type MeasurementKey = (typeof MEASUREMENT_FIELDS)[number]['key']
