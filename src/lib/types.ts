// Tipos que reflejan el esquema de supabase/migrations. Los pesos siempre están en kg.

export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'forearms'
  | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'abs'
export type Mechanics = 'compound' | 'isolation'
export type Modality = 'free_weight' | 'machine' | 'cable' | 'bodyweight'
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced'
export type MainGoal = 'muscle_gain' | 'fat_loss' | 'recomposition' | 'strength'
export type WeightUnit = 'kg' | 'lb'
export type RoutineStatus = 'active' | 'paused' | 'archived'
export type SessionStatus = 'in_progress' | 'completed' | 'abandoned'
export type SetType = 'warmup' | 'normal' | 'failure' | 'drop' | 'rest_pause'
export type PhotoCategory = 'front' | 'side' | 'back' | 'other'
export type PrType = 'max_weight' | 'max_reps_at_weight' | 'est_1rm' | 'max_session_volume'
export type GoalType = 'body_weight' | 'strength' | 'attendance' | 'volume' | 'measurement'
export type GoalStatus = 'pending' | 'in_progress' | 'completed' | 'paused'
export type ScheduleStatus = 'scheduled' | 'completed' | 'skipped' | 'rest'
export type ChallengeType = 'weekly_workouts' | 'exercise_improvement' | 'routine_consistency' | 'monthly_attendance'
export type PartnershipStatus = 'pending' | 'accepted' | 'rejected'

export interface Profile {
  id: string
  email: string
  full_name: string
  avatar_path: string | null
  birth_date: string | null
  height_cm: number | null
  initial_weight_kg: number | null
  target_weight_kg: number | null
  tracking_start_date: string
  experience_level: ExperienceLevel | null
  main_goal: MainGoal | null
  training_preferences: string | null
  created_at: string
  updated_at: string
}

export interface UserPreferences {
  user_id: string
  weight_unit: WeightUnit
  timezone: string
  default_rest_seconds: number
  weekly_workout_target: number
  share_workouts: boolean
  share_measurements: boolean
  share_photos: boolean
  notify_scheduled: boolean
  notify_challenges: boolean
  notify_records: boolean
  notify_goals: boolean
  notify_weekly_summary: boolean
}

export interface Partnership {
  id: string
  requester_id: string
  addressee_id: string
  status: PartnershipStatus
  created_at: string
  responded_at: string | null
}

export interface Exercise {
  id: string
  owner_id: string | null
  name: string
  primary_muscle: MuscleGroup
  mechanics: Mechanics
  modality: Modality
  equipment: string | null
  instructions: string | null
  common_mistakes: string | null
  video_url: string | null
  image_url: string | null
  exercise_muscles?: { muscle: MuscleGroup }[]
}

export interface RoutineExercise {
  id: string
  routine_day_id: string
  exercise_id: string
  position: number
  target_sets: number
  target_reps_min: number | null
  target_reps_max: number | null
  target_weight_kg: number | null
  rest_seconds: number | null
  notes: string | null
  exercise?: Pick<Exercise, 'id' | 'name' | 'primary_muscle'>
}

export interface RoutineDay {
  id: string
  routine_id: string
  name: string
  position: number
  day_of_week: number | null
  muscle_groups: MuscleGroup[]
  notes: string | null
  routine_exercises?: RoutineExercise[]
}

export interface Routine {
  id: string
  owner_id: string
  name: string
  description: string | null
  status: RoutineStatus
  template_key: string | null
  shared_with_partner: boolean
  created_at: string
  updated_at: string
  routine_days?: RoutineDay[]
}

export interface WorkoutSet {
  id: string
  workout_exercise_id: string
  set_number: number
  weight_kg: number
  reps: number
  set_type: SetType
  completed: boolean
  completed_at: string | null
  rpe: number | null
  rir: number | null
  notes: string | null
}

export interface WorkoutExercise {
  id: string
  session_id: string
  exercise_id: string
  position: number
  rest_seconds: number | null
  notes: string | null
  exercise?: Pick<Exercise, 'id' | 'name' | 'primary_muscle'>
  workout_sets?: WorkoutSet[]
}

export interface WorkoutSession {
  id: string
  user_id: string
  routine_id: string | null
  routine_day_id: string | null
  name: string
  started_at: string
  ended_at: string | null
  status: SessionStatus
  notes: string | null
  workout_exercises?: WorkoutExercise[]
}

export interface BodyMeasurement {
  id: string
  user_id: string
  measured_on: string
  weight_kg: number | null
  height_cm: number | null
  waist_cm: number | null
  chest_cm: number | null
  hips_cm: number | null
  arm_left_cm: number | null
  arm_right_cm: number | null
  forearm_left_cm: number | null
  forearm_right_cm: number | null
  thigh_left_cm: number | null
  thigh_right_cm: number | null
  calf_left_cm: number | null
  calf_right_cm: number | null
  body_fat_pct: number | null
  method: string | null
  notes: string | null
  created_at: string
}

export interface ProgressPhoto {
  id: string
  user_id: string
  storage_path: string
  taken_on: string
  category: PhotoCategory
  visible_to_partner: boolean
  notes: string | null
  created_at: string
}

export interface PersonalRecord {
  id: string
  user_id: string
  exercise_id: string
  record_type: PrType
  value: number
  previous_value: number | null
  weight_kg: number | null
  reps: number | null
  session_id: string
  achieved_at: string
  exercise?: Pick<Exercise, 'id' | 'name' | 'primary_muscle'>
}

export interface Goal {
  id: string
  user_id: string
  goal_type: GoalType
  title: string
  exercise_id: string | null
  measurement_field: string | null
  start_value: number | null
  target_value: number
  target_date: string | null
  status: GoalStatus
  archived: boolean
  completed_at: string | null
  notes: string | null
  created_at: string
  exercise?: Pick<Exercise, 'id' | 'name'> | null
}

export interface ScheduledWorkout {
  id: string
  user_id: string
  scheduled_on: string
  routine_id: string | null
  routine_day_id: string | null
  status: ScheduleStatus
  session_id: string | null
  notes: string | null
  routine?: Pick<Routine, 'id' | 'name'> | null
  routine_day?: Pick<RoutineDay, 'id' | 'name'> | null
}

export interface Challenge {
  id: string
  created_by: string
  title: string
  description: string | null
  challenge_type: ChallengeType
  exercise_id: string | null
  routine_id: string | null
  target_value: number
  start_date: string
  end_date: string
  status: 'active' | 'cancelled'
  created_at: string
  challenge_participants?: { user_id: string; is_owner: boolean }[]
  exercise?: Pick<Exercise, 'id' | 'name'> | null
  routine?: Pick<Routine, 'id' | 'name'> | null
}

export interface ChallengeProgress {
  user_id: string
  progress: number
  goal: number
  outcome: 'active' | 'completed' | 'failed' | 'cancelled'
}

export interface AppNotification {
  id: string
  user_id: string
  kind: 'scheduled_workout' | 'challenge_ending' | 'personal_record' | 'goal_achieved' | 'weekly_summary' | 'partner'
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}
