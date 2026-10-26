
import { get, set } from './store.js';

const D = {
    en: {
        home: 'Home',
        dashboard: 'Dashboard',
        trade: 'Trade',
        portfolio: 'Portfolio',
        ai: 'AI',
        heatmap: 'Heat Map',
        news: 'News',
        algos: 'Algorithms',
        backtest: 'Backtest',
        admin: 'Admin',
        book: 'Order Book',
        login: 'Login / Signup',
        logout: 'Logout',
        settings: 'Settings'
    },

    hi: {
        home: 'होम',
        dashboard: 'डैशबोर्ड',
        trade: 'ट्रेड',
        portfolio: 'पोर्टफोलियो',
        ai: 'एआई',
        heatmap: 'हीट मैप',
        news: 'समाचार',
        algos: 'एल्गोरिदम',
        backtest: 'बैकटेस्ट',
        admin: 'एडमिन',
        book: 'ऑर्डर बुक',
        login: 'लॉगिन / साइनअप',
        logout: 'लॉगआउट',
        settings: 'सेटिंग्स'
    },

    mr: {
        home: 'मुख्यपृष्ठ',
        dashboard: 'डॅशबोर्ड',
        trade: 'ट्रेड',
        portfolio: 'पोर्टफोलिओ',
        ai: 'एआय',
        heatmap: 'हीट मॅप',
        news: 'बातम्या',
        algos: 'अल्गोरिदम',
        backtest: 'बॅकटेस्ट',
        admin: 'अॅडमिन',
        book: 'ऑर्डर बुक',
        login: 'लॉगिन / साइनअप',
        logout: 'लॉगआउट',
        settings: 'सेटिंग्ज'
    }
};

export const t = k =>
    (D[get().uiLang] || D.en)[k] || D.en[k] || k;

export function setUiLang(l) {
    localStorage.setItem('qt_lang', l);
    set({ uiLang: l });
    document.documentElement.lang = l;
}
