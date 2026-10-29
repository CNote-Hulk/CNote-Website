// Texts of the course certificates (course.html) in the six site languages.
// Kept in its own small module on purpose: adding keys to i18n.js means bumping its cache-busting version at every
// import site (22 scripts) and in main.js on 113 pages. Only course.js needs these strings.
const MESSAGES = {
    en: {
        cert_btn_view: 'View Certificate', cert_btn_list: 'Certificates', cert_menu_title: 'Your certificates', cert_menu_view: 'View',
        cert_locked_title: 'Certificate Locked',
        cert_locked_course: 'Complete all lessons to unlock your certificate.',
        cert_locked_part: 'Complete every lesson in this part to unlock its certificate.',
        cert_progress: 'Progress', cert_lessons_done: '{done} of {total} lessons completed', cert_whole_course: 'The whole course',
        cert_of_completion: 'Certificate of Completion', cert_certifies: 'This certifies that', cert_completed_text: 'has successfully completed',
        cert_rank_label: 'Earned Rank', cert_date: 'Date', cert_completed_label: 'Completed', cert_lessons_count: '{n} lessons', cert_close: 'Close',
        part_basics: 'The Basics', part_deep_dive: 'Deep Dive',
        cert_profile_title: 'Certificates', cert_earned_on: 'Earned {date}', cert_stat_sub: '{earned} of {total} certificates earned', cert_goal_desc: '{done} of {total} lessons',
    },
    ro: {
        cert_btn_view: 'Vezi certificatul', cert_btn_list: 'Certificate', cert_menu_title: 'Certificatele tale', cert_menu_view: 'Vezi',
        cert_locked_title: 'Certificat blocat',
        cert_locked_course: 'Termină toate lecțiile ca să deblochezi certificatul.',
        cert_locked_part: 'Termină toate lecțiile din această parte ca să-i deblochezi certificatul.',
        cert_progress: 'Progres', cert_lessons_done: '{done} din {total} lecții terminate', cert_whole_course: 'Tot cursul',
        cert_of_completion: 'Certificat de absolvire', cert_certifies: 'Se certifică faptul că', cert_completed_text: 'a finalizat cu succes',
        cert_rank_label: 'Rang obținut', cert_date: 'Data', cert_completed_label: 'Finalizat', cert_lessons_count: '{n} lecții', cert_close: 'Închide',
        part_basics: 'Bazele', part_deep_dive: 'Aprofundare',
        cert_profile_title: 'Certificate', cert_earned_on: 'Obținut pe {date}', cert_stat_sub: '{earned} din {total} certificate obținute', cert_goal_desc: '{done} din {total} lecții',
    },
    de: {
        cert_btn_view: 'Zertifikat ansehen', cert_btn_list: 'Zertifikate', cert_menu_title: 'Deine Zertifikate', cert_menu_view: 'Ansehen',
        cert_locked_title: 'Zertifikat gesperrt',
        cert_locked_course: 'Schließe alle Lektionen ab, um dein Zertifikat freizuschalten.',
        cert_locked_part: 'Schließe jede Lektion dieses Teils ab, um sein Zertifikat freizuschalten.',
        cert_progress: 'Fortschritt', cert_lessons_done: '{done} von {total} Lektionen abgeschlossen', cert_whole_course: 'Der gesamte Kurs',
        cert_of_completion: 'Abschlusszertifikat', cert_certifies: 'Hiermit wird bestätigt, dass', cert_completed_text: 'erfolgreich abgeschlossen hat',
        cert_rank_label: 'Erreichter Rang', cert_date: 'Datum', cert_completed_label: 'Abgeschlossen', cert_lessons_count: '{n} Lektionen', cert_close: 'Schließen',
        part_basics: 'Grundlagen', part_deep_dive: 'Vertiefung',
        cert_profile_title: 'Zertifikate', cert_earned_on: 'Erhalten am {date}', cert_stat_sub: '{earned} von {total} Zertifikaten erhalten', cert_goal_desc: '{done} von {total} Lektionen',
    },
    es: {
        cert_btn_view: 'Ver certificado', cert_btn_list: 'Certificados', cert_menu_title: 'Tus certificados', cert_menu_view: 'Ver',
        cert_locked_title: 'Certificado bloqueado',
        cert_locked_course: 'Completa todas las lecciones para desbloquear tu certificado.',
        cert_locked_part: 'Completa todas las lecciones de esta parte para desbloquear su certificado.',
        cert_progress: 'Progreso', cert_lessons_done: '{done} de {total} lecciones completadas', cert_whole_course: 'Todo el curso',
        cert_of_completion: 'Certificado de finalización', cert_certifies: 'Se certifica que', cert_completed_text: 'ha completado con éxito',
        cert_rank_label: 'Rango obtenido', cert_date: 'Fecha', cert_completed_label: 'Completado', cert_lessons_count: '{n} lecciones', cert_close: 'Cerrar',
        part_basics: 'Fundamentos', part_deep_dive: 'En profundidad',
        cert_profile_title: 'Certificados', cert_earned_on: 'Obtenido el {date}', cert_stat_sub: '{earned} de {total} certificados obtenidos', cert_goal_desc: '{done} de {total} lecciones',
    },
    fr: {
        cert_btn_view: 'Voir le certificat', cert_btn_list: 'Certificats', cert_menu_title: 'Tes certificats', cert_menu_view: 'Voir',
        cert_locked_title: 'Certificat verrouillé',
        cert_locked_course: 'Termine toutes les leçons pour débloquer ton certificat.',
        cert_locked_part: 'Termine toutes les leçons de cette partie pour débloquer son certificat.',
        cert_progress: 'Progression', cert_lessons_done: '{done} leçons sur {total} terminées', cert_whole_course: 'Tout le cours',
        cert_of_completion: 'Certificat de réussite', cert_certifies: 'Il est certifié que', cert_completed_text: 'a terminé avec succès',
        cert_rank_label: 'Rang obtenu', cert_date: 'Date', cert_completed_label: 'Terminé', cert_lessons_count: '{n} leçons', cert_close: 'Fermer',
        part_basics: 'Les bases', part_deep_dive: 'Approfondissement',
        cert_profile_title: 'Certificats', cert_earned_on: 'Obtenu le {date}', cert_stat_sub: '{earned} certificats sur {total} obtenus', cert_goal_desc: '{done} leçons sur {total}',
    },
    it: {
        cert_btn_view: 'Vedi il certificato', cert_btn_list: 'Certificati', cert_menu_title: 'I tuoi certificati', cert_menu_view: 'Vedi',
        cert_locked_title: 'Certificato bloccato',
        cert_locked_course: 'Completa tutte le lezioni per sbloccare il tuo certificato.',
        cert_locked_part: 'Completa tutte le lezioni di questa parte per sbloccare il suo certificato.',
        cert_progress: 'Progresso', cert_lessons_done: '{done} lezioni su {total} completate', cert_whole_course: 'L’intero corso',
        cert_of_completion: 'Certificato di completamento', cert_certifies: 'Si certifica che', cert_completed_text: 'ha completato con successo',
        cert_rank_label: 'Grado ottenuto', cert_date: 'Data', cert_completed_label: 'Completato', cert_lessons_count: '{n} lezioni', cert_close: 'Chiudi',
        part_basics: 'Le basi', part_deep_dive: 'Approfondimento',
        cert_profile_title: 'Certificati', cert_earned_on: 'Ottenuto il {date}', cert_stat_sub: '{earned} certificati su {total} ottenuti', cert_goal_desc: '{done} lezioni su {total}',
    },
};

const LOCALES = { en: 'en-US', ro: 'ro-RO', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT' };

export function certT(key, lang, vars) {
    const dict = MESSAGES[lang] || MESSAGES.en;
    let s = dict[key] ?? MESSAGES.en[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    return s;
}

// A part's slug ('basics', 'deep-dive') -> its display name; unknown slugs fall back to a readable version of the slug.
export function partLabel(part, lang) {
    const key = 'part_' + String(part).replace(/-/g, '_');
    const dict = MESSAGES[lang] || MESSAGES.en;
    return dict[key] ?? MESSAGES.en[key] ?? String(part).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// The date printed on a certificate: the real completion date when the server gave one, otherwise today.
export function certDate(iso, lang) {
    const d = iso ? new Date(iso) : new Date();
    const date = isNaN(d.getTime()) ? new Date() : d;
    return date.toLocaleDateString(LOCALES[lang] || 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// What a certificate is called: "<course> — <part>" for a part certificate, just the course title otherwise.
export function certName(courseTitle, part, lang) {
    return part ? `${courseTitle} — ${partLabel(part, lang)}` : courseTitle;
}
