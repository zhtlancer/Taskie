/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F0EFFF',
          100: '#E4E1FF',
          200: '#CBC5FF',
          300: '#ADA4FE',
          400: '#8E82FD',
          500: '#6C63FF', // Primary blue-violet
          600: '#564CE0',
          700: '#433AC0',
          800: '#322B97',
          900: '#231D70',
        },
        accent: {
          50: '#FFFDF0',
          100: '#FFF9D6',
          200: '#FFF3AD',
          300: '#FFEB85',
          400: '#FFE25C',
          500: '#FFD93D', // Warm yellow accent
          600: '#E6BF22',
          700: '#BF9B0F',
          800: '#947608',
          900: '#6E5603',
        },
        success: {
          light: '#E6F8F0',
          DEFAULT: '#38D399',
          dark: '#10B981',
        },
        subject: {
          chinese: '#FF6B6B',
          math: '#4D96FF',
          english: '#6BCB77',
          other: '#FFD93D',
        }
      },
      fontFamily: {
        sans: [
          'system-ui',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          'sans-serif'
        ],
        chinese: [
          'system-ui',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          'sans-serif'
        ],
        display: [
          '"ZCOOL KuaiLe"',
          'Nunito',
          '"LXGW WenKai Screen"',
          'sans-serif'
        ]
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
      },
      boxShadow: {
        'card': '0 4px 20px -2px rgba(108, 99, 255, 0.08), 0 2px 6px -1px rgba(0, 0, 0, 0.04)',
        'card-hover': '0 10px 25px -3px rgba(108, 99, 255, 0.16), 0 4px 10px -2px rgba(0, 0, 0, 0.06)',
        'button': '0 4px 14px 0 rgba(108, 99, 255, 0.35)',
        'yellow-button': '0 4px 14px 0 rgba(255, 217, 61, 0.45)',
      },
      keyframes: {
        floatCoin: {
          '0%': { transform: 'translateY(0) scale(0.6)', opacity: '0' },
          '20%': { transform: 'translateY(-15px) scale(1.2)', opacity: '1' },
          '80%': { transform: 'translateY(-45px) scale(1)', opacity: '0.9' },
          '100%': { transform: 'translateY(-65px) scale(0.8)', opacity: '0' },
        },
        flameWiggle: {
          '0%, 100%': { transform: 'rotate(0deg) scale(1)' },
          '20%': { transform: 'rotate(-12deg) scale(1.15)' },
          '40%': { transform: 'rotate(10deg) scale(1.2)' },
          '60%': { transform: 'rotate(-8deg) scale(1.1)' },
          '80%': { transform: 'rotate(6deg) scale(1.05)' },
        },
        bounceOnce: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(0.92)' },
        },
        popIn: {
          '0%': { transform: 'scale(0.8)', opacity: '0' },
          '80%': { transform: 'scale(1.05)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        }
      },
      animation: {
        'float-coin': 'floatCoin 1s ease-out forwards',
        'flame-wiggle': 'flameWiggle 0.6s ease-in-out',
        'bounce-once': 'bounceOnce 0.2s ease-in-out',
        'pop-in': 'popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      }
    },
  },
  plugins: [],
}
