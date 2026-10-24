# Genera supabase/migrations/20261023000005_seed_exercises.sql a partir de esta lista.
# Uso: python scripts/gen-exercise-seed.py
import pathlib

# nombre, músculo principal, mecánica, modalidad, equipamiento, secundarios, instrucciones, errores comunes
EXERCISES = [
    ("Press de banca con barra", "chest", "compound", "free_weight", "Barra y banco plano", ["triceps", "shoulders"], "Acuéstate con los ojos bajo la barra, escápulas retraídas y pies firmes. Baja la barra controlada hasta la parte media del pecho y empuja hasta extender los codos.", "Rebotar la barra en el pecho; despegar los glúteos del banco; abrir los codos a 90°."),
    ("Press inclinado con mancuernas", "chest", "compound", "free_weight", "Mancuernas y banco inclinado", ["shoulders", "triceps"], "Banco a 30-45°. Baja las mancuernas a los lados del pecho superior con los codos a unos 45° y empuja hacia arriba.", "Inclinación excesiva del banco; rango de movimiento corto."),
    ("Press de pecho en máquina", "chest", "compound", "machine", "Máquina de press", ["triceps", "shoulders"], "Ajusta el asiento para que las manijas queden a la altura del pecho medio. Empuja sin bloquear los codos de golpe.", "Asiento mal ajustado; despegar la espalda del respaldo."),
    ("Aperturas con mancuernas", "chest", "isolation", "free_weight", "Mancuernas y banco", [], "Con codos ligeramente flexionados, abre los brazos en arco hasta sentir estiramiento en el pecho y vuelve a juntar.", "Bajar demasiado con peso excesivo; convertirlo en un press."),
    ("Cruce de poleas", "chest", "isolation", "cable", "Poleas altas", ["shoulders"], "Da un paso al frente, torso ligeramente inclinado, y junta las manos frente al pecho en arco.", "Usar impulso del torso; flexionar demasiado los codos."),
    ("Fondos en paralelas", "chest", "compound", "bodyweight", "Barras paralelas", ["triceps", "shoulders"], "Inclina el torso hacia adelante, baja hasta que los hombros queden a la altura de los codos y empuja.", "Bajar demasiado con dolor de hombro; balancearse."),
    ("Flexiones", "chest", "compound", "bodyweight", "Ninguno", ["triceps", "shoulders", "abs"], "Cuerpo en línea recta, manos algo más abiertas que los hombros. Baja el pecho cerca del suelo y empuja.", "Cadera caída; codos totalmente abiertos."),
    ("Dominadas", "back", "compound", "bodyweight", "Barra fija", ["biceps", "forearms"], "Agarre prono algo más ancho que los hombros. Tira llevando el pecho hacia la barra y baja controlado hasta extender.", "Kipping sin control; medio rango de movimiento."),
    ("Jalón al pecho", "back", "compound", "cable", "Polea alta con barra", ["biceps"], "Siéntate con los muslos fijos, tira la barra hacia la parte alta del pecho llevando los codos hacia abajo.", "Inclinarse demasiado atrás; tirar con los brazos en lugar de la espalda."),
    ("Remo con barra", "back", "compound", "free_weight", "Barra", ["biceps", "hamstrings"], "Bisagra de cadera con espalda neutra, tira la barra hacia el abdomen bajo y baja controlado.", "Redondear la espalda baja; usar impulso de la cadera."),
    ("Remo con mancuerna a una mano", "back", "compound", "free_weight", "Mancuerna y banco", ["biceps"], "Apoya rodilla y mano en el banco. Tira la mancuerna hacia la cadera manteniendo el torso estable.", "Rotar el torso; encoger el hombro."),
    ("Remo sentado en polea", "back", "compound", "cable", "Polea baja con agarre en V", ["biceps"], "Torso erguido, tira el agarre hacia el abdomen juntando escápulas y extiende controlado.", "Balancear el torso; encoger hombros."),
    ("Peso muerto convencional", "back", "compound", "free_weight", "Barra", ["hamstrings", "glutes", "forearms"], "Barra sobre medio pie, espalda neutra, empuja el suelo con las piernas y extiende la cadera. Baja con control.", "Redondear la espalda; alejar la barra del cuerpo; hiperextender arriba."),
    ("Pullover en polea", "back", "isolation", "cable", "Polea alta con cuerda o barra", [], "Con brazos casi extendidos, lleva la barra desde arriba hasta los muslos usando los dorsales.", "Flexionar los codos convirtiéndolo en un jalón de tríceps."),
    ("Press militar con barra", "shoulders", "compound", "free_weight", "Barra", ["triceps"], "De pie, glúteos y abdomen firmes. Empuja la barra desde la clavícula hasta arriba de la cabeza.", "Arquear la zona lumbar; empujar la barra hacia adelante."),
    ("Press de hombros con mancuernas", "shoulders", "compound", "free_weight", "Mancuernas y banco", ["triceps"], "Sentado con respaldo, empuja las mancuernas desde la altura de las orejas hasta arriba.", "Rango corto; arquear la espalda."),
    ("Elevaciones laterales", "shoulders", "isolation", "free_weight", "Mancuernas", [], "Eleva las mancuernas a los lados hasta la altura de los hombros con codos ligeramente flexionados.", "Usar impulso; subir por encima de los hombros encogiendo trapecios."),
    ("Elevaciones laterales en polea", "shoulders", "isolation", "cable", "Polea baja", [], "De lado a la polea, eleva el brazo hasta la altura del hombro con control.", "Inclinar el torso para ayudar."),
    ("Face pull", "shoulders", "isolation", "cable", "Polea con cuerda", ["back"], "Tira la cuerda hacia la cara separando las manos y rotando externamente los hombros.", "Usar demasiado peso; tirar hacia el pecho."),
    ("Pájaros (deltoides posterior)", "shoulders", "isolation", "free_weight", "Mancuernas", ["back"], "Inclinado con espalda neutra, abre los brazos a los lados con codos suaves.", "Tirar con la espalda baja; usar impulso."),
    ("Curl con barra", "biceps", "isolation", "free_weight", "Barra", ["forearms"], "Codos pegados al cuerpo, flexiona hasta contraer el bíceps y baja controlado.", "Balancear el torso; adelantar los codos."),
    ("Curl con mancuernas alterno", "biceps", "isolation", "free_weight", "Mancuernas", ["forearms"], "Flexiona un brazo a la vez supinando la muñeca durante la subida.", "Rango incompleto; usar impulso."),
    ("Curl martillo", "biceps", "isolation", "free_weight", "Mancuernas", ["forearms"], "Agarre neutro, flexiona los codos sin moverlos de los costados.", "Balancear; separar los codos."),
    ("Curl en polea", "biceps", "isolation", "cable", "Polea baja", ["forearms"], "Frente a la polea, flexiona con codos fijos manteniendo tensión constante.", "Inclinarse hacia atrás."),
    ("Curl predicador", "biceps", "isolation", "machine", "Banco Scott o máquina", [], "Brazos apoyados en el cojín, flexiona y baja casi a extensión completa controlado.", "Dejar caer el peso abajo; despegar los codos."),
    ("Extensión de tríceps en polea", "triceps", "isolation", "cable", "Polea alta con cuerda o barra", [], "Codos fijos a los costados, extiende hasta bloquear y regresa controlado.", "Mover los codos; inclinarse sobre la polea."),
    ("Press francés", "triceps", "isolation", "free_weight", "Barra Z y banco", [], "Acostado, baja la barra hacia la frente flexionando solo los codos y extiende.", "Abrir los codos; mover los hombros."),
    ("Extensión de tríceps sobre la cabeza", "triceps", "isolation", "cable", "Polea con cuerda", [], "De espaldas a la polea, extiende los brazos por encima de la cabeza manteniendo los codos cerca.", "Arquear la espalda; abrir los codos."),
    ("Press de banca agarre cerrado", "triceps", "compound", "free_weight", "Barra y banco", ["chest", "shoulders"], "Agarre al ancho de hombros, codos cerca del torso, baja al pecho bajo y empuja.", "Agarre demasiado cerrado que fuerza las muñecas."),
    ("Curl de muñeca", "forearms", "isolation", "free_weight", "Barra o mancuernas", [], "Antebrazos apoyados, flexiona las muñecas hacia arriba y baja controlado.", "Usar todo el brazo; rango corto."),
    ("Paseo del granjero", "forearms", "compound", "free_weight", "Mancuernas pesadas", ["abs", "back"], "Camina erguido sosteniendo pesos a los lados con pasos cortos y controlados.", "Inclinarse; encoger los hombros."),
    ("Sentadilla con barra", "quads", "compound", "free_weight", "Barra y rack", ["glutes", "hamstrings", "abs"], "Barra sobre trapecios, pies al ancho de hombros. Baja con la espalda neutra hasta al menos paralelo y sube empujando el suelo.", "Rodillas hacia adentro; talones despegados; redondear la espalda."),
    ("Prensa de piernas", "quads", "compound", "machine", "Máquina de prensa", ["glutes", "hamstrings"], "Pies al ancho de cadera en la plataforma. Baja controlado sin despegar la pelvis y empuja sin bloquear las rodillas.", "Bajar tanto que la pelvis se despega; bloquear las rodillas."),
    ("Sentadilla búlgara", "quads", "compound", "free_weight", "Mancuernas y banco", ["glutes"], "Pie trasero sobre el banco. Baja la rodilla trasera hacia el suelo manteniendo el torso estable.", "Pie delantero demasiado cerca; perder el equilibrio por prisa."),
    ("Extensión de cuádriceps", "quads", "isolation", "machine", "Máquina de extensión", [], "Ajusta el rodillo sobre los tobillos. Extiende las rodillas y baja controlado.", "Patear el peso; levantar la cadera del asiento."),
    ("Sentadilla hack", "quads", "compound", "machine", "Máquina hack", ["glutes"], "Espalda apoyada, baja controlado hasta una profundidad cómoda y empuja.", "Despegar los talones; rodillas hacia adentro."),
    ("Zancadas", "quads", "compound", "free_weight", "Mancuernas", ["glutes", "hamstrings"], "Da un paso largo y baja hasta que ambas rodillas formen unos 90°. Empuja para volver.", "Rodilla delantera colapsando hacia adentro."),
    ("Peso muerto rumano", "hamstrings", "compound", "free_weight", "Barra o mancuernas", ["glutes", "back"], "Rodillas suaves, lleva la cadera atrás bajando la barra pegada a las piernas hasta sentir estiramiento.", "Redondear la espalda; flexionar demasiado las rodillas."),
    ("Curl femoral acostado", "hamstrings", "isolation", "machine", "Máquina de curl femoral", [], "Acostado boca abajo, flexiona las rodillas llevando el rodillo hacia los glúteos.", "Levantar la cadera; usar impulso."),
    ("Curl femoral sentado", "hamstrings", "isolation", "machine", "Máquina de curl femoral sentado", [], "Ajusta el respaldo y flexiona las rodillas con control.", "Rango incompleto."),
    ("Hip thrust con barra", "glutes", "compound", "free_weight", "Barra y banco", ["hamstrings"], "Espalda alta sobre el banco, empuja la cadera hacia arriba hasta alinear torso y muslos, contrae glúteos.", "Hiperextender la espalda baja; pies demasiado lejos."),
    ("Patada de glúteo en polea", "glutes", "isolation", "cable", "Polea baja con tobillera", [], "Extiende la cadera llevando la pierna hacia atrás sin arquear la espalda.", "Arquear la zona lumbar."),
    ("Abducción de cadera en máquina", "glutes", "isolation", "machine", "Máquina abductora", [], "Sentado, abre las piernas contra la resistencia y vuelve controlado.", "Usar impulso; rango corto."),
    ("Elevación de talones de pie", "calves", "isolation", "machine", "Máquina o escalón", [], "Sube sobre las puntas lo más alto posible, pausa, y baja hasta estirar la pantorrilla.", "Rebotar; rango corto."),
    ("Elevación de talones sentado", "calves", "isolation", "machine", "Máquina de pantorrilla sentado", [], "Con las rodillas bajo el cojín, eleva los talones y baja con control.", "Rebotar abajo."),
    ("Plancha", "abs", "isolation", "bodyweight", "Ninguno", ["shoulders"], "Apoya antebrazos y puntas, cuerpo en línea recta, abdomen y glúteos firmes.", "Cadera caída o demasiado alta; contener la respiración."),
    ("Crunch en polea", "abs", "isolation", "cable", "Polea alta con cuerda", [], "De rodillas, flexiona el tronco llevando los codos hacia las rodillas.", "Tirar con los brazos; mover la cadera."),
    ("Elevación de piernas colgado", "abs", "isolation", "bodyweight", "Barra fija", ["forearms"], "Colgado, eleva las piernas controlando el balanceo y baja lentamente.", "Balancearse; usar impulso."),
    ("Rueda abdominal", "abs", "compound", "bodyweight", "Rueda abdominal", ["shoulders", "back"], "De rodillas, rueda hacia adelante manteniendo el abdomen firme y regresa sin arquear la espalda.", "Arquear la zona lumbar; ir más lejos de lo que se controla."),
]


def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def main() -> None:
    root = pathlib.Path(__file__).resolve().parent.parent
    lines = [
        "-- =====================================================================",
        "-- GYM BRO — Biblioteca global de ejercicios (datos de referencia, no de usuario)",
        "-- owner_id = null => visibles para todos. Generado por scripts/gen-exercise-seed.py",
        "-- =====================================================================",
        "insert into public.exercises (name, primary_muscle, mechanics, modality, equipment, instructions, common_mistakes) values",
        ",\n".join(f"  ({q(e[0])}, '{e[1]}', '{e[2]}', '{e[3]}', {q(e[4])}, {q(e[6])}, {q(e[7])})" for e in EXERCISES),
        "on conflict do nothing;",
        "",
        "insert into public.exercise_muscles (exercise_id, muscle)",
        "select e.id, m.muscle::public.muscle_group",
        "from (values",
        ",\n".join(f"  ({q(e[0])}, '{m}')" for e in EXERCISES for m in e[5]),
        ") as m(name, muscle)",
        "join public.exercises e on e.owner_id is null and e.name = m.name",
        "on conflict do nothing;",
    ]
    out = root / "supabase" / "migrations" / "20261023000005_seed_exercises.sql"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(EXERCISES)} ejercicios -> {out}")


if __name__ == "__main__":
    main()
