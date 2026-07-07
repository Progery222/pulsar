export interface TourStep {
  id: string;
  target: string | null;
  title: string;
  description: string;
  tips?: string[];
  position: "center" | "top" | "bottom" | "left" | "right";
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    target: null,
    title: "Добро пожаловать в Студию",
    description: "Давайте коротко пройдёмся по редактору",
    position: "center",
  },
  {
    id: "assets",
    target: "[data-tour='assets']",
    title: "Панель ассетов",
    description: "Ваш творческий набор. Импорт медиа, AI-генерация, фигуры, стикеры и свои SVG.",
    tips: [
      "Перетаскивайте видео, аудио, изображения",
      "Вкладка AI: генерация картинок и фонов ИИ",
      "Фигуры и импорт своих SVG",
      "Стикеры, фоны и оверлеи",
    ],
    position: "right",
  },
  {
    id: "timeline",
    target: "[data-tour='timeline']",
    title: "Таймлайн",
    description: "Расставляйте и монтируйте клипы. Тяните для перемещения, за края — для обрезки.",
    tips: ["S — разрезать клип", "Пробел — играть/пауза", "Колесо — масштаб"],
    position: "top",
  },
  {
    id: "preview",
    target: "[data-tour='preview']",
    title: "Превью",
    description: "Смотрите результат в реальном времени по мере монтажа.",
    tips: [
      "Стрелки — по кадрам",
      "Клик — перемотка",
      "Есть полноэкранный режим",
    ],
    position: "left",
  },
  {
    id: "inspector",
    target: "[data-tour='inspector']",
    title: "Инспектор",
    description:
      "Выберите клип, чтобы увидеть его свойства. Эффекты, цвет, анимация.",
    tips: [
      "Трансформация, эффекты, цветокор",
      "Кейфреймы для любого свойства",
      "Инструменты на базе ИИ",
    ],
    position: "left",
  },
  {
    id: "complete",
    target: null,
    title: "Всё готово!",
    description: "Творите! Нажмите ? в любой момент для списка хоткеев.",
    position: "center",
  },
];

export const ONBOARDING_KEY = "openreel-onboarding-complete";
