import axios from 'axios';

export interface WeatherData {
    temp: number;
    description: string;
    isSunny: boolean;
    clouds: number;
    forecastTomorrow: {
        temp: number;
        isSunny: boolean;
    };
    raw: any;
}

export async function fetchWeather(apiKey: string, lat: string, lon: string): Promise<WeatherData> {
    // Note: One Call API 2.5 is deprecated or requires subscription. Using 2.5 current + 5 day forecast as fallback if needed.
    // For now, attempting 2.5 current weather for basic node data.
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const response = await axios.get(url);
    const current = response.data;

    // Simple logic for "isSunny"
    const isSunny = current.clouds.all < 20;

    return {
        temp: current.main.temp,
        description: current.weather[0].description,
        isSunny: isSunny,
        clouds: current.clouds.all,
        forecastTomorrow: {
            temp: 0, // Need separate call for forecast 2.5
            isSunny: false
        },
        raw: response.data
    };
}
