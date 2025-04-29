const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const yf = require('yahoo-finance2').default;
const cron = require('node-cron');
const moment = require('moment');
const { CookieJar } = require('tough-cookie');

// Конфигурация
const TELEGRAM_TOKEN = '7598714456:AAFeZYaYFxk7i3oCogw9XMwCpizqPQQ9kug';
const CHAT_ID = '5064349647';
const ALERT_RANGES = [0.01, 0.05]; // Процентные диапазоны для уведомлений (мин и макс)
const EXCHANGES = ['NDAQ'];//['NDAQ', 'NYSE'];
const TEST_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA']; // Тестовые акции
const api_key = "D7F4ESUBAP6P46DY";
const CHECK_INTERVAL = 3000;
// Инициализация бота
const bot = new TelegramBot(TELEGRAM_TOKEN, {polling: true});

// Кэш для хранения предыдущих цен
const priceCache = new Map();

/*bot.on('message', (msg) => {
  console.log('Chat ID:', msg.chat.id);
  bot.sendMessage(msg.chat.id, `Ваш Chat ID: ${msg.chat.id}`);
});
*/


async function getStockData(symbol) {
  try {
    const quote = await yf.quote(symbol);
    const { regularMarketPrice, currency } = quote;
    return regularMarketPrice;
    //const response = await axios.get(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=${api_key}`);
    //return response.data['Time Series (Daily)'];
  } catch (error) {
    console.error(`Error fetching data for ${symbol}:`, error.message);
    return null;
  }
}

// Функция для проверки изменений цены
function checkPriceChange(symbol, currentPrice) {
  if (!priceCache.has(symbol)) {
    priceCache.set(symbol, {
      lastClose: currentPrice,
      lastNotification: null
    });
    return false;
  }

  const cachedData = priceCache.get(symbol);
  const percentChange = ((currentPrice - cachedData.lastClose) / cachedData.lastClose) * 100;
  console.log('symbol', symbol);
  console.log('percentChange', percentChange);
  // Проверяем, попадает ли изменение в наш диапазон
  const absChange = Math.abs(percentChange);
  if (absChange >= ALERT_RANGES[0] && absChange <= ALERT_RANGES[1]) {
    // Проверяем, не отправляли ли мы уже уведомление по этому изменению
    if (!cachedData.lastNotification || 
        Math.sign(percentChange) !== Math.sign(cachedData.lastNotification.change)) {
      cachedData.lastNotification = {
        change: percentChange,
        timestamp: Date.now()
      };
      return percentChange;
    }
  }

  return false;
}

async function getYahooCrumb() {
  const { headers } = await axios.get('https://finance.yahoo.com/lookup', {
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });
  
  const cookie = headers['set-cookie']?.join('; ');
  if (!cookie) throw new Error('Failed to get cookies');
  
  // Альтернативный метод получения crumb
  const crumbResponse = await axios.get(
    'https://query1.finance.yahoo.com/v1/test/getcrumb',
    { headers: { Cookie: cookie } }
  );
  
  return { cookie, crumb: crumbResponse.data };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getSP500Stocks() {
  try {
    // 1. Получаем с
    //const { cookie, crumb } = await getYahooCrumb();
    const wikiResponse = await axios.get(
      'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
    );
    const symbols = [...wikiResponse.data.matchAll(/href=".*?\/quote\/XNYS:([A-Z]+)/g)]
      .map(match => match[1]);
    
    // 2. Фильтруем по биржам через Yahoo Finance
    const filtered = [];
    for (const symbol of symbols.slice(0, 10)) { // Ограничение из-за лимитов
      console.log('symbol', symbol);
      //const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=price&crumb=${crumb}`;
      //const response = await yf.quote(symbol);
      const quote = await yf.quote(symbol);
      const { regularMarketPrice, currency } = quote;
      /*const response = await axios.get(url,{
        headers: { 
          Cookie: cookie,
          'User-Agent': 'Mozilla/5.0'
        }
      });*/
      console.log('currency', currency);
      console.log('regularMarketPrice', regularMarketPrice);
      await sleep(1500); // Пауза 1.5 секунды
      
      /*const exchange = response.data.quoteSummary.result[0]?.price?.exchangeName;
      
      if (exchange && ['NASDAQ', 'New York Stock Exchange'].includes(exchange)) {
        filtered.push({
          symbol,
          name: response.data.quoteSummary.result[0].price.shortName,
          exchange
        });
      }*/

    }
    
    return filtered;
  } catch (error) {
    console.error('Error:', error);
    return [];
  }
}



async function checkStocks() {
  //const MONITORED_STOCKS = ['AAPL', 'MSFT', 'TSLA', 'NVDA', 'AMD'];
  const ALERT_THRESHOLD = 0.001; // 3%

  for (const symbol of TEST_SYMBOLS) {
    try {
      // Получаем текущую и предыдущую цену
      const [quote, historical] = await Promise.all([
        yf.quote(symbol),
        yf.historical(symbol, { period1: moment().subtract(5, 'days').format('YYYY-MM-DD'), interval: '1d' })
      ]);

      const currentPrice = quote.regularMarketPrice;
      const previousClose = historical[historical.length - 1].close;
      const change = checkPriceChange(symbol, currentPrice);
      if (change) {
        const direction = change > 0 ? '📈 Рост' : '📉 Падение';
        const message = `${direction} ${symbol}: ${(change * 100).toFixed(2)}%\n` +
                       `Предыдущая цена: $${previousClose.toFixed(2)}\n` +
                       `Текущая цена: $${currentPrice.toFixed(2)}\n` +
                       `Время: ${new Date().toLocaleString()}`;

        bot.sendMessage(CHAT_ID, message);
        console.log(`Alert sent for ${symbol}`);
      }
      
    } catch (error) {
      console.error(`Ошибка для ${symbol}:`, error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000)); // Пауза 1 сек
  }
}

// Основная функция проверки акций


async function getCurrentPrice(symbol) {
  try {
    const quote = await yf.quote(symbol);
    const { regularMarketPrice, currency } = quote;
    return regularMarketPrice;
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error.message);
    return null;
  }
}

// -------------------------------------------------------------------
// Запускаем проверку каждые 3 секунды
//setInterval(testStockAlerts, CHECK_INTERVAL);

// Расписание проверки (каждый час в рабочее время биржи)
/*cron.schedule('0 9-16 * * 1-5', () => {
  console.log('Running stock check...');
  checkStocks();
}, {
  timezone: "America/New_York"
});*/
//---------------------------------------------------------------------

//setInterval(checkStocks, 1 * 30 * 1000);
//checkStocks(); // Первый запуск

bot.onText(/\/check/, async (msg)=>{
  checkStocks();
  bot.sendMessage(msg.chat.id, 'Запущена проверка акций S&P 500');
});

// проверка цены акции в формате /price {NAME}
bot.onText(/\/price ([A-Za-z0-9]{1,5})/, async (msg, match)=>{
  const price = await getCurrentPrice(match[1]);  
  const chatId = msg.chat.id;
  if(price)
    bot.sendMessage(chatId, price); 
  else
    bot.sendMessage(chatId, `Акций с именем ${match[1]} не найдено`); 
})

// Команды бота
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Бот мониторинга акций S&P 500 запущен. Я буду присылать уведомления при изменениях цены на 3-5%.');
});

console.log('Бот запущен...');
