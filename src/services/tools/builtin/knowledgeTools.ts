import { toolRegistry } from '../registry';
import { def, ok, err } from '../toolHelpers';

toolRegistry.register(
  def('company_lookup', 'Unternehmens-Info', 'Informationen zu einem Unternehmen (Wikipedia)', 'knowledge',
    { company: { type: 'string', description: 'Unternehmensname' } },
    ['network']),
  async (args) => {
    const company = args.company as string;
    try {
      const res = await fetch(`https://de.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(company)}`);
      if (!res.ok) {
        const res2 = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(company)}`);
        if (!res2.ok) return err('Unternehmen nicht gefunden');
        const data2 = await res2.json();
        return ok({ name: data2.title, description: data2.extract, url: data2.content_urls?.desktop?.page });
      }
      const data = await res.json();
      return ok({ name: data.title, description: data.extract, url: data.content_urls?.desktop?.page });
    } catch (e) { return err(`Lookup-Fehler: ${(e as Error).message}`); }
  }
);

toolRegistry.register(
  def('weather_lookup', 'Wetter', 'Aktuelles Wetter für einen Ort', 'knowledge',
    { location: { type: 'string', description: 'Ortsname' } },
    ['network']),
  async (args) => {
    const location = args.location as string;
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
      const data = await res.json();
      const current = data.current_condition?.[0];
      if (!current) return err('Keine Wetterdaten');
      return ok({
        location,
        temp_c: current.temp_C,
        feels_like: current.FeelsLikeC,
        humidity: current.humidity,
        description: current.weatherDesc?.[0]?.value,
        wind_kmph: current.windspeedKmph,
      });
    } catch (e) { return err(`Wetterfehler: ${(e as Error).message}`); }
  }
);

toolRegistry.register(
  def('translate_text', 'Übersetzung', 'Text übersetzen', 'knowledge',
    { text: { type: 'string', description: 'Zu übersetzender Text' }, target_lang: { type: 'string', description: 'Zielsprache (z.B. en, de, fr)' } },
    ['network']),
  async (args) => {
    const { text, target_lang } = args as { text: string; target_lang: string };
    try {
      const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${target_lang}`);
      const data = await res.json();
      return ok({ original: text, translated: data.responseData?.translatedText, targetLang: target_lang });
    } catch (e) { return err(`Übersetzungsfehler: ${(e as Error).message}`); }
  }
);
