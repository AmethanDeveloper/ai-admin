// Демо-центр, который создаётся автоматически при первом обращении.
// Данные вымышленные: так сервис показывают владельцам на встречах.

export const DEMO_SLUG = "brightway";

export type Course = { name: string; for: string; format: string; price: string };
export type Faq = { q: string; a: string };
/** Оформление чата: цвет центра, шапка и логотип. logo: "" — нет, "upload:<версия>" — загружен в кабинете, "/assets/…" — файл сервиса. */
export type Brand = { color: string; header: "light" | "brand"; pattern: "none" | "uk"; logo: string };
export const DEFAULT_BRAND: Brand = { color: "#0B6B4E", header: "light", pattern: "none", logo: "" };
export const DEMO_BRAND: Brand = { color: "#D63D32", header: "brand", pattern: "none", logo: "/assets/bright-english-mark.svg" };
/** Дожим после пробного: тексты сообщений и автоотправка в WhatsApp. В текстах: {имя}, {центр}, {курс}. */
export type FollowUp = { auto: boolean; came: string; noshow: string };
export const DEFAULT_FOLLOWUP: FollowUp = {
  auto: true,
  came: "Здравствуйте, {имя}! Спасибо, что пришли на пробный урок в «{центр}». Как вам занятие? Если остались вопросы о группе, расписании или оплате — ответим. Можем забронировать за вами место в группе.",
  noshow: "Здравствуйте, {имя}! Не получилось встретиться на пробном уроке в «{центр}» — ничего страшного. Подобрать другое удобное время?",
};
export type Settings = {
  name: string;
  city: string;
  address: string;
  hours: string;
  phone: string;
  utcOffset: number;
  trial: { durationMin: number; price: string; capacityPerSlot: number; whatHappens: string };
  slots: Record<string, string[]>;
  studentTypes: string[];
  courses: Course[];
  faq: Faq[];
  brand?: Brand;
  followUp?: FollowUp;
};

export const DEMO_SETTINGS: Settings = {
  name: "Bright English",
  city: "Астана",
  address: "пр. Мангилик Ел, 00, офис 1 (демо-адрес)",
  hours: "Пн–Пт 10:00–20:00, Сб 10:00–15:00, Вс выходной",
  phone: "+7 700 000 00 00",
  utcOffset: 5,
  trial: {
    durationMin: 45,
    price: "бесплатно",
    capacityPerSlot: 3,
    whatHappens: "Знакомство с преподавателем, короткий тест на уровень, мини-урок и подбор группы",
  },
  slots: {
    mon: ["16:00", "18:30"],
    tue: ["16:00", "18:30"],
    wed: ["16:00", "18:30"],
    thu: ["16:00", "18:30"],
    fri: ["16:00", "18:30"],
    sat: ["11:00", "13:00"],
    sun: [],
  },
  studentTypes: ["Ребёнок 7–12 лет", "Подросток 13–17 лет", "Взрослый"],
  courses: [
    { name: "Английский для детей", for: "7–12 лет", format: "группа до 8 человек, 3 раза в неделю по 60 минут", price: "35 000 ₸ в месяц" },
    { name: "Английский для подростков", for: "13–17 лет", format: "группа до 8 человек, 3 раза в неделю по 60 минут", price: "38 000 ₸ в месяц" },
    { name: "Разговорный английский", for: "взрослые", format: "группа до 6 человек, 2 раза в неделю по 90 минут", price: "40 000 ₸ в месяц" },
    { name: "Подготовка к IELTS", for: "от 15 лет, уровень от Intermediate", format: "группа до 6 человек, 3 раза в неделю, пробный тест каждую субботу", price: "55 000 ₸ в месяц" },
  ],
  brand: structuredClone(DEMO_BRAND),
  faq: [
    { q: "Есть ли онлайн-обучение?", a: "Да, все курсы есть и онлайн, цена та же." },
    { q: "Как определить уровень?", a: "На бесплатном пробном уроке преподаватель проводит короткий тест и подбирает группу." },
    { q: "Можно ли заморозить абонемент?", a: "Да, до 2 недель по болезни со справкой." },
    { q: "Есть ли скидки?", a: "Скидка 10% второму ребёнку из одной семьи. Другие скидки обсуждает администратор." },
    { q: "Какие учебники?", a: "Учебники Cambridge, стоимость входит в абонемент." },
    { q: "Можно ли оплатить через Kaspi?", a: "Да, Kaspi QR или перевод, также наличные и карта." },
  ],
};

/** Пустой шаблон для нового центра: владелец заполняет его в кабинете. */
export function blankSettings(name: string): Settings {
  return {
    ...structuredClone(DEMO_SETTINGS),
    name,
    brand: structuredClone(DEFAULT_BRAND),
    address: "",
    phone: "",
    courses: [],
    faq: [],
  };
}
