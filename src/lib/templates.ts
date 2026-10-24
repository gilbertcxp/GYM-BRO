// Plantillas iniciales. Son solo un punto de partida: al usarlas se crea una rutina propia y editable.
// Los ejercicios se buscan por nombre en la biblioteca global (supabase/migrations/*_seed_exercises.sql).
import type { MuscleGroup } from './types'

export interface TemplateExercise { name: string; sets: number; repsMin: number; repsMax: number; rest: number }
export interface TemplateDay { name: string; dayOfWeek: number | null; muscles: MuscleGroup[]; exercises: TemplateExercise[] }
export interface RoutineTemplate { key: string; name: string; description: string; days: TemplateDay[] }

const ex = (name: string, sets: number, repsMin: number, repsMax: number, rest = 90): TemplateExercise => ({ name, sets, repsMin, repsMax, rest })

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    key: 'ppl', name: 'Push / Pull / Legs', description: 'Empuje, tirón y pierna. Se puede repetir dos veces por semana.',
    days: [
      { name: 'Push', dayOfWeek: 1, muscles: ['chest', 'shoulders', 'triceps'], exercises: [
        ex('Press de banca con barra', 4, 6, 8, 150), ex('Press inclinado con mancuernas', 3, 8, 10, 120),
        ex('Press de hombros con mancuernas', 3, 8, 10, 120), ex('Elevaciones laterales', 3, 12, 15, 60), ex('Extensión de tríceps en polea', 3, 10, 12, 60)] },
      { name: 'Pull', dayOfWeek: 3, muscles: ['back', 'biceps'], exercises: [
        ex('Dominadas', 4, 6, 10, 150), ex('Remo con barra', 3, 8, 10, 120), ex('Jalón al pecho', 3, 10, 12, 90),
        ex('Face pull', 3, 12, 15, 60), ex('Curl con barra', 3, 8, 12, 60)] },
      { name: 'Legs', dayOfWeek: 5, muscles: ['quads', 'hamstrings', 'glutes', 'calves'], exercises: [
        ex('Sentadilla con barra', 4, 5, 8, 180), ex('Peso muerto rumano', 3, 8, 10, 150), ex('Prensa de piernas', 3, 10, 12, 120),
        ex('Curl femoral acostado', 3, 10, 12, 60), ex('Elevación de talones de pie', 4, 10, 15, 60)] },
    ],
  },
  {
    key: 'upper_lower', name: 'Torso / Pierna', description: 'Cuatro días alternando tren superior e inferior.',
    days: [
      { name: 'Torso A', dayOfWeek: 1, muscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'], exercises: [
        ex('Press de banca con barra', 4, 6, 8, 150), ex('Remo con barra', 4, 6, 8, 150), ex('Press militar con barra', 3, 8, 10, 120),
        ex('Jalón al pecho', 3, 10, 12, 90), ex('Curl martillo', 2, 10, 12, 60), ex('Extensión de tríceps en polea', 2, 10, 12, 60)] },
      { name: 'Pierna A', dayOfWeek: 2, muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'], exercises: [
        ex('Sentadilla con barra', 4, 5, 8, 180), ex('Peso muerto rumano', 3, 8, 10, 150), ex('Extensión de cuádriceps', 3, 10, 15, 60),
        ex('Elevación de talones sentado', 3, 12, 15, 60), ex('Crunch en polea', 3, 12, 15, 60)] },
      { name: 'Torso B', dayOfWeek: 4, muscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'], exercises: [
        ex('Press inclinado con mancuernas', 4, 8, 10, 120), ex('Remo sentado en polea', 4, 8, 12, 90), ex('Elevaciones laterales', 3, 12, 15, 60),
        ex('Dominadas', 3, 6, 10, 120), ex('Curl con mancuernas alterno', 2, 10, 12, 60), ex('Press francés', 2, 10, 12, 60)] },
      { name: 'Pierna B', dayOfWeek: 5, muscles: ['quads', 'hamstrings', 'glutes', 'calves'], exercises: [
        ex('Peso muerto convencional', 3, 4, 6, 180), ex('Sentadilla búlgara', 3, 8, 10, 90), ex('Hip thrust con barra', 3, 8, 12, 90),
        ex('Curl femoral sentado', 3, 10, 12, 60), ex('Elevación de talones de pie', 3, 10, 15, 60)] },
    ],
  },
  {
    key: 'full_body', name: 'Full Body', description: 'Tres sesiones de cuerpo completo por semana.',
    days: [
      { name: 'Full Body A', dayOfWeek: 1, muscles: ['quads', 'chest', 'back', 'shoulders'], exercises: [
        ex('Sentadilla con barra', 3, 6, 8, 180), ex('Press de banca con barra', 3, 6, 8, 150), ex('Remo con barra', 3, 8, 10, 120),
        ex('Elevaciones laterales', 2, 12, 15, 60), ex('Rueda abdominal', 2, 8, 12, 60)] },
      { name: 'Full Body B', dayOfWeek: 3, muscles: ['hamstrings', 'shoulders', 'back', 'glutes'], exercises: [
        ex('Peso muerto rumano', 3, 8, 10, 150), ex('Press militar con barra', 3, 6, 8, 150), ex('Jalón al pecho', 3, 10, 12, 90),
        ex('Hip thrust con barra', 3, 8, 12, 90), ex('Curl con barra', 2, 10, 12, 60)] },
      { name: 'Full Body C', dayOfWeek: 5, muscles: ['quads', 'chest', 'back', 'triceps'], exercises: [
        ex('Prensa de piernas', 3, 10, 12, 120), ex('Press inclinado con mancuernas', 3, 8, 10, 120), ex('Remo con mancuerna a una mano', 3, 8, 12, 90),
        ex('Fondos en paralelas', 2, 8, 12, 90), ex('Elevación de talones de pie', 3, 10, 15, 60)] },
    ],
  },
  {
    key: 'bro_split', name: 'Bro Split', description: 'Un grupo muscular principal por día, cinco días.',
    days: [
      { name: 'Pecho', dayOfWeek: 1, muscles: ['chest'], exercises: [
        ex('Press de banca con barra', 4, 6, 8, 150), ex('Press inclinado con mancuernas', 3, 8, 10, 120), ex('Press de pecho en máquina', 3, 10, 12, 90), ex('Cruce de poleas', 3, 12, 15, 60)] },
      { name: 'Espalda', dayOfWeek: 2, muscles: ['back'], exercises: [
        ex('Dominadas', 4, 6, 10, 150), ex('Remo con barra', 3, 8, 10, 120), ex('Remo sentado en polea', 3, 10, 12, 90), ex('Pullover en polea', 3, 12, 15, 60)] },
      { name: 'Hombros', dayOfWeek: 3, muscles: ['shoulders'], exercises: [
        ex('Press militar con barra', 4, 6, 8, 150), ex('Elevaciones laterales', 4, 12, 15, 60), ex('Pájaros (deltoides posterior)', 3, 12, 15, 60), ex('Face pull', 3, 12, 15, 60)] },
      { name: 'Pierna', dayOfWeek: 4, muscles: ['quads', 'hamstrings', 'glutes', 'calves'], exercises: [
        ex('Sentadilla con barra', 4, 6, 8, 180), ex('Prensa de piernas', 3, 10, 12, 120), ex('Curl femoral acostado', 3, 10, 12, 60), ex('Elevación de talones de pie', 4, 10, 15, 60)] },
      { name: 'Brazos', dayOfWeek: 5, muscles: ['biceps', 'triceps', 'forearms'], exercises: [
        ex('Curl con barra', 3, 8, 12, 60), ex('Press de banca agarre cerrado', 3, 6, 8, 120), ex('Curl martillo', 3, 10, 12, 60),
        ex('Extensión de tríceps sobre la cabeza', 3, 10, 12, 60), ex('Curl de muñeca', 2, 12, 15, 45)] },
    ],
  },
  { key: 'custom', name: 'Rutina personalizada', description: 'Empieza desde cero.', days: [{ name: 'Día 1', dayOfWeek: null, muscles: [], exercises: [] }] },
]
