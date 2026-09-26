import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    // android/ и ios/ — вшитая веб-сборка внутри нативных проектов
    // (assets/public у Capacitor), появляется на диске после `cap
    // sync` и сама в git не попадает (см. */.gitignore), но линтер
    // этого не знает и разбирает уже собранный/минифицированный бандл
    // как исходный код — тысячи ложных ошибок на ровном месте.
    ignores: ['dist', 'android/**', 'ios/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  /* Сервер. Раньше он под линтер не попадал вовсе: правила стояли на
     .ts и .tsx, а серверные .mjs разбирались как браузерный код — без
     console, без Buffer, без process. Ошибки на пустом месте приучали
     не смотреть в вывод, и настоящая находка терялась среди них.

     Это не косметика. Именно no-undef ловит имя, которое перестало быть
     видимым внутри файла после правки импортов: `export ... from` вывозит
     имя наружу, но в область видимости самого файла его не вносит. Такая
     ошибка не видна ни node --check, ни глазами — только на живом
     запросе, и выглядит как поломка сервера. */
  {
    files: ['server/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly', process: 'readonly', Buffer: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', TextEncoder: 'readonly',
        TextDecoder: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly',
        fetch: 'readonly', Response: 'readonly', Request: 'readonly',
        Headers: 'readonly', FormData: 'readonly', Blob: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        setImmediate: 'readonly', queueMicrotask: 'readonly',
        structuredClone: 'readonly', crypto: 'readonly',
        __dirname: 'readonly', __filename: 'readonly',
      },
    },
    rules: {
      /* Параметр, который перестал быть нужен, — это не ошибка сборки, а
         повод прибраться. Ошибкой оставляем только необъявленное имя. */
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

      /* Управляющие символы в регулярном выражении здесь — не описка, а
         смысл: этими выражениями мы их из входных данных и вырезаем.
         Нулевой байт в имени файла, перевод строки в заголовке —
         обычные приёмы, и выражение, которое их ищет, обязано их
         содержать. */
      'no-control-regex': 'off',
    },
  },

  /* Главный процесс Electron: тот же пробел, что был у server/*.mjs —
     CommonJS (require/__dirname), а не браузерный код. */
  {
    files: ['electron/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'readonly', __dirname: 'readonly', __filename: 'readonly',
        process: 'readonly', console: 'readonly', Buffer: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', Response: 'readonly', Request: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
);
