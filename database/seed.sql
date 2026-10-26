-- Demo seed data. Passwords are NOT seeded here: the C++ server creates the demo/admin users itself (see README).
INSERT INTO instruments(symbol,name,sector,kind,tick_size,market_cap_cr) VALUES
('RELIANCE','Reliance Industries','Energy','stock',0.05,1960000),('ONGC','ONGC','Energy','stock',0.05,340000),('HDFCBANK','HDFC Bank','Banking','stock',0.05,1260000),
('ICICIBANK','ICICI Bank','Banking','stock',0.05,810000),('TCS','Tata Consultancy','IT','stock',0.05,1420000),('INFY','Infosys','IT','stock',0.05,620000),
('SUNPHARMA','Sun Pharma','Pharma','stock',0.05,410000),('DRREDDY','Dr Reddys Labs','Pharma','stock',0.05,107000),('ITC','ITC','FMCG','stock',0.05,540000),
('HUL','Hindustan Unilever','FMCG','stock',0.05,575000),('MARUTI','Maruti Suzuki','Auto','stock',0.05,393000),('TATAMOTORS','Tata Motors','Auto','stock',0.05,354000),
('TATASTEEL','Tata Steel','Metal','stock',0.05,187000),('HINDALCO','Hindalco','Metal','stock',0.05,146000),('DLF','DLF','Realty','stock',0.05,203000),
('BTC-INR','Bitcoin (INR)','Crypto','crypto',10,NULL),('ETH-INR','Ethereum (INR)','Crypto','crypto',1,NULL),
('NIFTY50','Nifty 50','Index','index',0.05,NULL),('SENSEX','BSE Sensex','Index','index',0.05,NULL),('NASDAQ','Nasdaq Composite','Index','index',0.05,NULL),('DOWJONES','Dow Jones','Index','index',0.05,NULL)
ON CONFLICT (symbol) DO NOTHING;
INSERT INTO strategies(id,name,description,default_params) VALUES
('mean_reversion','Mean Reversion','Buys k standard deviations below the moving average.','{"window":20,"k":1.5}'),
('momentum','Momentum Trading','Holds while rate-of-change and trend filter are positive.','{"lookback":20,"trend":50}'),
('arbitrage','Arbitrage','Trades the gap between two venues.','{"window":10,"entry_z":1.5}'),
('scalping','Scalping','Short holds with tight TP/SL.','{"take_profit":0.003,"stop_loss":0.002}'),
('pair_trading','Pair Trading','Long/short a cointegrated pair on spread z-score.','{"window":40,"entry_z":2}'),
('breakout','Breakout Strategy','Donchian channel breakout.','{"window":20}'),
('ma_crossover','Moving Average Crossover','Fast MA above slow MA.','{"fast":10,"slow":30}'),
('vwap','VWAP Strategy','Buys below rolling VWAP.','{"window":50,"band":0.002}')
ON CONFLICT (id) DO NOTHING;
