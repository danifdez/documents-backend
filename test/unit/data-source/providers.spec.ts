import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { CsvUrlProvider } from '../../../src/data-source/providers/csv-url.provider';
import { EurostatProvider } from '../../../src/data-source/providers/eurostat.provider';
import { FredProvider } from '../../../src/data-source/providers/fred.provider';
import { OpenWeatherProvider } from '../../../src/data-source/providers/open-weather.provider';
import { RestApiProvider } from '../../../src/data-source/providers/rest-api.provider';
import { WorldBankProvider } from '../../../src/data-source/providers/world-bank.provider';
import { YahooFinanceProvider } from '../../../src/data-source/providers/yahoo-finance.provider';
import type { SafeUrlService } from '../../../src/data-source/safe-url.service';

describe('Data source providers', () => {
  const url = 'https://data.example.org/records';
  const credentials = { apiKey: 'example-key' };
  let http: { get: jest.Mock; post: jest.Mock };
  let httpService: HttpService;
  let assertSafe: jest.Mock;
  let csv: CsvUrlProvider;
  let rest: RestApiProvider;

  const response = (data: unknown) => of({ data });
  const outage = () => throwError(() => new Error('upstream unavailable'));

  beforeEach(() => {
    http = { get: jest.fn(), post: jest.fn() };
    httpService = http as unknown as HttpService;
    assertSafe = jest.fn().mockResolvedValue(undefined);
    const safeUrl = { assertSafe } as unknown as SafeUrlService;
    csv = new CsvUrlProvider(httpService, safeUrl);
    rest = new RestApiProvider(httpService, safeUrl);
  });

  describe('CSV and JSON feed', () => {
    it('validates URL and format', () => {
      expect(csv.validateConfig({})).toEqual([
        'URL is required',
        'Format must be csv or json',
      ]);
      expect(csv.validateConfig({ url, format: 'xml' })).toEqual([
        'Format must be csv or json',
      ]);
      expect(csv.validateConfig({ url, format: 'json' })).toEqual([]);
    });

    it('parses quoted CSV cells and pads missing columns', async () => {
      http.get.mockReturnValue(
        response('name;notes\n"A;B";"a ""quote"""\nC\n\n'),
      );
      await expect(
        csv.fetch(
          { url, format: 'csv', csvDelimiter: ';' },
          { authHeader: 'Bearer example' },
        ),
      ).resolves.toEqual({
        records: [
          { name: 'A;B', notes: 'a "quote"' },
          { name: 'C', notes: null },
        ],
      });
      expect(assertSafe).toHaveBeenCalledWith(url);
      expect(http.get).toHaveBeenCalledWith(url, {
        headers: { Authorization: 'Bearer example' },
        responseType: 'text',
        timeout: 30000,
        maxRedirects: 0,
      });
    });

    it('returns no records for a header-only feed and limits connection previews', async () => {
      http.get.mockReturnValueOnce(response('name\n'));
      await expect(csv.fetch({ url, format: 'csv' })).resolves.toEqual({
        records: [],
      });
      const items = Array.from({ length: 7 }, (_, id) => ({ id }));
      http.get.mockReturnValueOnce(response({ outer: { rows: items } }));
      await expect(
        csv.testConnection({ url, format: 'json', jsonDataPath: 'outer.rows' }),
      ).resolves.toEqual({
        success: true,
        message: 'Successfully fetched 7 records',
        sampleData: items.slice(0, 5),
      });
      http.get.mockReturnValueOnce(response(items));
      await expect(csv.fetch({ url, format: 'json' })).resolves.toEqual({
        records: items,
      });
    });

    it('reports the path when a JSON feed has no array', async () => {
      http.get.mockReturnValueOnce(response({}));
      await expect(
        csv.testConnection({ url, format: 'json', jsonDataPath: 'outer.rows' }),
      ).resolves.toEqual({
        success: false,
        message:
          'Connection failed: Expected an array at path "outer.rows", got undefined',
      });
    });

    it('does not send a request when URL validation fails', async () => {
      assertSafe.mockRejectedValue(new Error('URL rejected'));
      await expect(csv.fetch({ url, format: 'csv' })).rejects.toThrow(
        'URL rejected',
      );
      expect(http.get).not.toHaveBeenCalled();
    });
  });

  describe('REST API', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const config = { url, dataPath: 'data.rows' };

    it('validates the configuration and reads a nested response with configured headers', async () => {
      expect(rest.validateConfig({})).toEqual([
        'URL is required',
        'Data path is required',
      ]);
      expect(rest.validateConfig(config)).toEqual([]);
      http.get.mockReturnValue(response({ data: { rows: items } }));
      await expect(
        rest.testConnection(
          {
            ...config,
            headers: '{"X-Import":"yes"}',
            queryParams: '{"q":"test"}',
          },
          { bearerToken: 'example', apiKey: 'unused' },
        ),
      ).resolves.toMatchObject({
        success: true,
        sampleData: items,
      });
      expect(http.get).toHaveBeenCalledWith(url, {
        headers: {
          Accept: 'application/json',
          'X-Import': 'yes',
          Authorization: 'Bearer example',
        },
        params: { q: 'test' },
        timeout: 30000,
        maxRedirects: 0,
      });
      expect(assertSafe).toHaveBeenCalledWith(url);
    });

    const pages = [
      {
        mode: 'page',
        key: 'page',
        first: 1,
        next: 2,
        extra: { totalPath: 'total' },
        firstMetadata: { total: 3 },
      },
      {
        mode: 'offset',
        key: 'offset',
        first: 0,
        next: 2,
        extra: {},
        firstMetadata: {},
      },
      {
        mode: 'cursor',
        key: 'cursor',
        first: 'saved',
        next: 'next',
        extra: { cursorPath: 'next' },
        firstMetadata: { next: 'next' },
      },
    ];
    it.each(pages)(
      'reads $mode pagination in order and stops at the end',
      async (scenario) => {
        http.get
          .mockReturnValueOnce(
            response({
              data: { rows: items.slice(0, 2) },
              ...scenario.firstMetadata,
            }),
          )
          .mockReturnValueOnce(
            response({ data: { rows: items.slice(2) }, total: 3 }),
          );
        await expect(
          rest.fetch(
            {
              ...config,
              pagination: scenario.mode,
              paginationParam: scenario.key,
              pageSize: 2,
              pageSizeParam: 'limit',
              ...scenario.extra,
            },
            { apiKey: 'example', apiKeyHeader: 'X-Token' },
            'saved',
          ),
        ).resolves.toEqual({ records: items });
        expect(
          http.get.mock.calls.map(([, options]) => options.params),
        ).toEqual([
          { [scenario.key]: scenario.first, limit: 2 },
          { [scenario.key]: scenario.next, limit: 2 },
        ]);
        expect(http.get.mock.calls[0][1].headers).toEqual({
          Accept: 'application/json',
          'X-Token': 'example',
        });
      },
    );

    it('uses POST with a parsed body and falls back for invalid optional JSON', async () => {
      http.post.mockReturnValue(response(items));
      await expect(
        rest.fetch(
          { url, method: 'post', body: '{"view":"all"}', pagination: 'none' },
          credentials,
        ),
      ).resolves.toEqual({ records: items });
      expect(http.post).toHaveBeenNthCalledWith(
        1,
        url,
        { view: 'all' },
        {
          headers: {
            Accept: 'application/json',
            'X-API-Key': credentials.apiKey,
          },
          params: {},
          timeout: 30000,
          maxRedirects: 0,
        },
      );
      await rest.fetch({
        url,
        method: 'POST',
        body: '{',
        queryParams: '{',
        headers: '{',
      });
      expect(http.post).toHaveBeenNthCalledWith(
        2,
        url,
        {},
        expect.objectContaining({
          headers: { Accept: 'application/json' },
          params: {},
        }),
      );
    });

    it('stops on empty data and reports transport failures', async () => {
      http.get
        .mockReturnValueOnce(response({ data: { rows: [] } }))
        .mockReturnValueOnce(outage());
      await expect(
        rest.fetch({ ...config, pagination: 'page' }),
      ).resolves.toEqual({ records: [] });
      await expect(rest.testConnection(config)).resolves.toEqual({
        success: false,
        message: 'Connection failed: upstream unavailable',
      });
    });
  });

  describe('Public data', () => {
    it('reads all World Bank pages and filters missing indicator values', async () => {
      const provider = new WorldBankProvider(httpService);
      expect(provider.validateConfig({})).toEqual([
        'Indicator code is required',
      ]);
      const config = {
        indicator: 'TEST',
        country: 'ESP',
        dateRange: '2022:2023',
      };
      const item = {
        country: { value: 'Spain' },
        countryiso3code: 'ESP',
        date: '2023',
        value: '2.5',
        indicator: { value: 'Indicator' },
      };
      http.get
        .mockReturnValueOnce(
          response([{ pages: 2, total: 3 }, [item, { ...item, value: null }]]),
        )
        .mockReturnValueOnce(
          response([
            { pages: 2, total: 3 },
            [{ ...item, date: '2022', value: 0 }],
          ]),
        );
      await expect(provider.fetch(config)).resolves.toMatchObject({
        records: [
          {
            country: 'Spain',
            country_code: 'ESP',
            year: 2023,
            value: 2.5,
            indicator: 'Indicator',
          },
          { year: 2022, value: 0 },
        ],
      });
      expect(http.get).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('/ESP/indicator/TEST'),
        {
          params: {
            date: '2022:2023',
            format: 'json',
            per_page: 1000,
            page: 2,
          },
          timeout: 30000,
        },
      );
      http.get.mockReturnValueOnce(response({}));
      await expect(
        provider.testConnection({ indicator: 'TEST' }),
      ).resolves.toMatchObject({ success: true, sampleData: [] });
      expect(http.get).toHaveBeenLastCalledWith(
        expect.stringContaining('/all/indicator/TEST'),
        expect.objectContaining({
          params: expect.objectContaining({ page: 1, per_page: 5 }),
        }),
      );
      http.get.mockReturnValueOnce(outage());
      await expect(provider.testConnection(config)).resolves.toMatchObject({
        success: false,
      });
    });

    it('maps Eurostat multidimensional observations, including sparse values and fallback labels', async () => {
      const provider = new EurostatProvider(httpService);
      expect(provider.validateConfig({})).toEqual(['Dataset code is required']);
      const config = {
        datasetCode: 'TEST',
        geo: 'ES',
        timePeriod: '2023',
        filters: '{"unit":"PC"}',
      };
      http.get.mockReturnValueOnce(
        response({
          id: ['geo', 'time', 'unknown'],
          size: [2, 2, 1],
          dimension: {
            geo: {
              category: { index: { ES: 0, PT: 1 }, label: { ES: 'Spain' } },
            },
            time: { category: { index: { '2022': 0, '2023': 1 } } },
          },
          value: { 0: 0, 1: null, 3: 7 },
        }),
      );
      await expect(provider.testConnection(config)).resolves.toMatchObject({
        success: true,
        sampleData: [
          {
            geo: 'ES',
            geo_label: 'Spain',
            time: '2022',
            time_label: '2022',
            unknown: '0',
            unknown_label: '0',
            value: 0,
          },
          {
            geo: 'PT',
            geo_label: 'PT',
            time: '2023',
            time_label: '2023',
            unknown: '0',
            unknown_label: '0',
            value: 7,
          },
        ],
      });
      expect(http.get).toHaveBeenCalledWith(expect.stringContaining('/TEST'), {
        params: {
          format: 'JSON',
          lang: 'en',
          geo: 'ES',
          time: '2023',
          unit: 'PC',
        },
        timeout: 60000,
      });
      http.get.mockReturnValueOnce(response({}));
      await expect(
        provider.fetch({ datasetCode: 'TEST', filters: '{' }),
      ).resolves.toEqual({ records: [] });
      http.get.mockReturnValueOnce(outage());
      await expect(provider.testConnection(config)).resolves.toMatchObject({
        success: false,
      });
    });

    it('authenticates FRED, preserves observation dates and skips the missing-value sentinel', async () => {
      const provider = new FredProvider(httpService);
      expect(provider.validateConfig({})).toEqual(['Series ID is required']);
      const config = {
        seriesId: 'TEST',
        observationStart: '2023-01-01',
        observationEnd: '2024-01-01',
        frequency: 'm',
        units: 'lin',
      };
      await expect(provider.fetch(config)).rejects.toThrow(
        'FRED API Key is required',
      );
      await expect(provider.testConnection(config)).resolves.toEqual({
        success: false,
        message: 'API Key is required',
      });
      expect(http.get).not.toHaveBeenCalled();
      http.get.mockReturnValueOnce(
        response({
          observations: [
            { date: '2023-01-01', value: '.' },
            { date: '2024-01-01', value: '2.50' },
          ],
        }),
      );
      await expect(
        provider.testConnection(config, credentials),
      ).resolves.toMatchObject({
        success: true,
        sampleData: [{ date: '2024-01-01', value: 2.5 }],
      });
      expect(http.get).toHaveBeenCalledWith(
        expect.stringContaining('/series/observations'),
        {
          params: {
            series_id: 'TEST',
            api_key: 'example-key',
            file_type: 'json',
            observation_start: '2023-01-01',
            observation_end: '2024-01-01',
            frequency: 'm',
            units: 'lin',
          },
          timeout: 30000,
        },
      );
      http.get
        .mockReturnValueOnce(response(null))
        .mockReturnValueOnce(outage());
      await expect(
        provider.fetch({ seriesId: 'TEST' }, credentials),
      ).resolves.toMatchObject({ records: [] });
      await expect(
        provider.testConnection(config, credentials),
      ).resolves.toMatchObject({ success: false });
    });

    it('maps Yahoo historical and quote data without converting missing prices to zero', async () => {
      const provider = new YahooFinanceProvider(httpService);
      expect(provider.validateConfig({})).toEqual(['Symbol is required']);
      const quote = {
        open: [2.123456, null],
        high: [3, null],
        low: [1, null],
        close: [2.4, null],
        volume: [0],
      };
      http.get.mockReturnValueOnce(
        response({
          chart: {
            result: [{ timestamp: [0, 86400], indicators: { quote: [quote] } }],
          },
        }),
      );
      await expect(provider.fetch({ symbol: '^ABC' })).resolves.toMatchObject({
        records: [
          {
            date: '1970-01-01',
            open: 2.1235,
            high: 3,
            low: 1,
            close: 2.4,
            volume: 0,
          },
          {
            date: '1970-01-02',
            open: null,
            high: null,
            low: null,
            close: null,
            volume: null,
          },
        ],
      });
      expect(http.get).toHaveBeenCalledWith(
        expect.stringContaining('/chart/%5EABC'),
        expect.objectContaining({ params: { range: '1y', interval: '1d' } }),
      );
      http.get.mockReturnValueOnce(
        response({
          quoteResponse: {
            result: [
              {
                symbol: 'ABC',
                shortName: 'A',
                regularMarketPrice: 12,
                currency: 'EUR',
              },
              { symbol: 'DEF', longName: 'Company D' },
            ],
          },
        }),
      );
      await expect(
        provider.testConnection({ symbol: 'ABC,DEF', dataType: 'quote' }),
      ).resolves.toMatchObject({
        success: true,
        sampleData: [
          { symbol: 'ABC', name: 'A', price: 12, currency: 'EUR' },
          { symbol: 'DEF', name: 'Company D' },
        ],
      });
      http.get
        .mockReturnValueOnce(response({}))
        .mockReturnValueOnce(response({}));
      await expect(
        provider.fetch({ symbol: 'ABC', dataType: 'quote' }),
      ).resolves.toMatchObject({ records: [] });
      await expect(
        provider.testConnection({ symbol: 'UNKNOWN' }),
      ).resolves.toMatchObject({
        success: false,
        message: expect.stringContaining('UNKNOWN'),
      });
    });

    it('maps current weather and forecast timestamps for zero-valued coordinates', async () => {
      const provider = new OpenWeatherProvider(httpService);
      const coordinates = { lat: 0, lon: 0 };
      expect(provider.validateConfig(coordinates)).toEqual([]);
      expect(provider.validateConfig({ lat: null })).toEqual([
        'Latitude is required',
        'Longitude is required',
      ]);
      await expect(provider.fetch(coordinates)).rejects.toThrow(
        'OpenWeatherMap API Key is required',
      );
      await expect(provider.testConnection(coordinates)).resolves.toEqual({
        success: false,
        message: 'API Key is required',
      });
      const weather = {
        dt: 3600,
        main: { temp: 0, feels_like: -2, humidity: 50, pressure: 1000 },
        wind: { speed: 8, deg: 0 },
        weather: [{ description: 'windy' }],
        clouds: { all: 20 },
        visibility: 10000,
      };
      http.get.mockReturnValueOnce(response({ ...weather, name: 'Origin' }));
      await expect(
        provider.testConnection(coordinates, credentials),
      ).resolves.toMatchObject({
        success: true,
        sampleData: [
          {
            datetime: '1970-01-01T01:00:00.000Z',
            temp: 0,
            feels_like: -2,
            humidity: 50,
            pressure: 1000,
            wind_speed: 8,
            wind_deg: 0,
            description: 'windy',
            clouds: 20,
            visibility: 10000,
            location: 'Origin',
          },
        ],
      });
      expect(http.get).toHaveBeenCalledWith(
        expect.stringContaining('/weather'),
        {
          params: {
            ...coordinates,
            appid: 'example-key',
            units: 'metric',
            lang: 'en',
          },
          timeout: 15000,
        },
      );
      http.get.mockReturnValueOnce(
        response({
          city: { name: 'Origin' },
          list: [{ ...weather, dt_txt: '1970-01-01 01:00:00' }, { dt: 7200 }],
        }),
      );
      await expect(
        provider.fetch(
          {
            ...coordinates,
            dataType: 'forecast',
            units: 'imperial',
            lang: 'es',
          },
          credentials,
        ),
      ).resolves.toMatchObject({
        records: [
          { datetime: '1970-01-01 01:00:00', temp: 0, location: 'Origin' },
          { datetime: '1970-01-01T02:00:00.000Z', location: 'Origin' },
        ],
      });
      expect(http.get).toHaveBeenLastCalledWith(
        expect.stringContaining('/forecast'),
        expect.objectContaining({
          params: expect.objectContaining({ units: 'imperial', lang: 'es' }),
        }),
      );
      http.get.mockReturnValueOnce(outage());
      await expect(
        provider.testConnection(coordinates, credentials),
      ).resolves.toMatchObject({ success: false });
    });
  });
});
