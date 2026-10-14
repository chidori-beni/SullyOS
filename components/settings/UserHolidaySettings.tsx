import React, { useEffect, useMemo, useState } from 'react';
import { useUiLocale } from '../../context/UiLocaleContext';
import { browserHolidayCache, deviceTimeZone, HOLIDAY_COUNTRIES, holidayCountryName, loadHolidayCalendar, renderHomeFestival, renderUserHoliday, type HolidayCalendar, type UserHolidayConfig } from '../../utils/userHolidays';
import { getLocalDateKey } from '../../utils/localDate';
import { MALAYSIA_HOLIDAY_REGIONS, malaysiaHolidayRegion } from '../../utils/malaysiaHolidayRegions';

const baseCountryOptions = HOLIDAY_COUNTRIES.map(c => ({ code: c.countryCode, name: c.name, label: holidayCountryName(c.countryCode) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));

export default function UserHolidaySettings({ value, onChange }: { value: UserHolidayConfig; onChange: (value: UserHolidayConfig) => void }) {
    const { locale, t } = useUiLocale();
    const countryOptions = useMemo(() => {
        const names = locale === 'ja-JP' && typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['ja'], { type: 'region' }) : undefined;
        return baseCountryOptions.map(c => ({ ...c, originalLabel: c.label, label: names?.of(c.code) || c.label })).sort((a, b) => a.label.localeCompare(b.label, locale));
    }, [locale]);
    const [calendar, setCalendar] = useState<HolidayCalendar | null>(null);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    useEffect(() => {
        let active = true;
        setCalendar(null);
        if (!value.enabled || !value.countryCode) { setLoading(false); return; }
        setLoading(true);
        loadHolidayCalendar(value.countryCode, new Date().getFullYear(), browserHolidayCache).then(data => {
            if (active) { setCalendar(data); setLoading(false); }
        }).catch(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [value.enabled, value.countryCode]);
    const regions = value.countryCode === 'MY' ? MALAYSIA_HOLIDAY_REGIONS.map(r => r.code)
        : [...new Set(calendar?.days.flatMap(d => d.regions || []) || [])].sort();
    const today = calendar ? renderUserHoliday(value, getLocalDateKey(new Date()), calendar.days) : '';
    // 家乡预览只给中国（本地按农历算，不用联网）；其它家乡等聊天时再按需取年度日历
    const homeToday = value.homeCountryCode === 'CN' ? renderHomeFestival(value, getLocalDateKey(new Date()), [], undefined, today) : '';
    const needle = search.trim().toLowerCase();
    return <section className="bg-amber-50/80 border border-amber-100 rounded-2xl p-4 space-y-3">
        <label className="flex items-center justify-between gap-3 text-sm font-bold text-amber-800">
            <span>{t('settings.holiday.title')}</span>
            <input type="checkbox" aria-label={t('settings.holiday.enable')} checked={value.enabled} onChange={e => onChange({ ...value, enabled: e.target.checked })} className="w-5 h-5 accent-amber-600" />
        </label>
        <p className="text-xs text-amber-800/70 leading-relaxed">{t('settings.holiday.help')}</p>
        {value.enabled && <>
            <input aria-label={t('settings.holiday.searchAria')} placeholder={t('settings.holiday.search')} value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-white border border-amber-100 rounded-xl px-3 py-2 text-sm" />
            <select aria-label={t('settings.holiday.country')} value={value.countryCode} onChange={e => onChange({ ...value, countryCode: e.target.value, subdivisionCode: undefined, timeZone: deviceTimeZone() })} className="w-full bg-white border border-amber-100 rounded-xl px-3 py-2 text-sm">
                <option value="">{t('settings.holiday.choose')}</option>
                {countryOptions.filter(c => c.code === value.countryCode || c.label.toLowerCase().includes(needle) || c.originalLabel.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle)).map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
            {regions.length > 0 && <label className="block text-xs text-amber-900 space-y-1">
                <span>{value.countryCode === 'MY' ? t('settings.holiday.myRegion') : t('settings.holiday.region')}</span>
                <select aria-label={t('settings.holiday.regionAria')} value={value.subdivisionCode || ''} onChange={e => onChange({ ...value, subdivisionCode: e.target.value || undefined })} className="w-full bg-white rounded-xl px-3 py-2 text-sm">
                    <option value="">{t('settings.holiday.national')}</option>
                    {value.subdivisionCode && !regions.includes(value.subdivisionCode) && <option value={value.subdivisionCode}>{value.subdivisionCode}{t('settings.holiday.saved')}</option>}
                    {regions.map(code => {
                        const region = value.countryCode === 'MY' ? malaysiaHolidayRegion(code) : undefined;
                        return <option key={code} value={code}>{region ? (locale === 'ja-JP' ? region.english : `${region.name} · ${region.english}`) : code}</option>;
                    })}
                </select>
            </label>}
            <label className="block text-xs text-amber-900 space-y-1">
                <span>{t('settings.holiday.home')}</span>
                <select aria-label={t('settings.holiday.homeAria')} value={value.homeCountryCode || ''} onChange={e => onChange({ ...value, homeCountryCode: e.target.value || undefined })} className="w-full bg-white border border-amber-100 rounded-xl px-3 py-2 text-sm">
                    <option value="">{t('settings.holiday.none')}</option>
                    {countryOptions.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
                <span className="block text-amber-800/70 leading-relaxed">{t('settings.holiday.homeHelp')}</span>
                {homeToday && <span className="block text-amber-900">{homeToday}</span>}
            </label>
            <p className="text-xs text-amber-800/70 leading-relaxed">{t('settings.holiday.time', { zone: deviceTimeZone() })}</p>
            {value.countryCode && <div role="status" className="text-xs text-amber-900 leading-relaxed">
                {loading ? t('settings.holiday.loading') : calendar ? <>
                    <div>{t('settings.holiday.loaded', { year: calendar.year, extra: value.countryCode === 'CN' ? t('settings.holiday.cnExtra') : '' })}</div>
                    <div className="mt-1">{today || t('settings.holiday.empty')}</div>
                </> : <div>{t('settings.holiday.unavailable')}</div>}
            </div>}
            <p className="text-[10px] text-amber-800/60">{value.countryCode === 'MY'
                ? t('settings.holiday.mySource')
                : t('settings.holiday.source')}</p>
        </>}
    </section>;
}
