#!/usr/bin/env python3
"""Deterministic Bitcoin Core fixture for browser tests only."""
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

started = time.time()
class FixtureServer(ThreadingHTTPServer):
    # Core collection sends concurrent RPC calls, plus mining/block-detail bursts.
    # The default five-connection backlog can cause intermittent connect timeouts.
    request_queue_size = 32

def transaction(height, index):
    vsize = 20000 if index % 700 == 699 else 120 + index % 400
    fee = vsize * [1, 3, 8, 25][index % 4]
    result = dict(txid=f'{height * 100000 + index:064x}', hash=f'{height * 100000 + index:064x}',
        blockhash=f'{height:064x}', size=vsize * 2, vsize=vsize, weight=vsize * 4,
        version=2, locktime=0, fee=round(fee / 1e8, 8),
        vin=[dict(txid=f'{(height-1)*100000 + index:064x}', vout=0, sequence=4294967295,
            prevout=dict(value=round(1 + fee / 1e8, 8), scriptPubKey=dict(address='bc1qfixtureprevious', type='witness_v0_keyhash')))],
        vout=[dict(n=0,value=.9,scriptPubKey=dict(address='bc1pfixtureoutput',type='witness_v1_taproot')),
              dict(n=1,value=.1,scriptPubKey=dict(address='bc1qfixturechange',type='witness_v0_keyhash'))])
    if index == 0:
        result.pop('fee')
        tag = ['Foundry USA Pool', '/AntPool/', '/ViaBTC/', 'fixture-unknown', 'fixture-unknown'][height % 5]
        result['vin'] = [dict(coinbase=(b'\x03abc'+tag.encode()).hex(),sequence=4294967295)]
        if height % 5 == 3:
            result['vout'][0]['scriptPubKey']['address'] = '1KFHE7w8BhaENAswwryaoccDb6qcT6DbYY'
    return result

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        method = req['method']
        now = int(time.time())
        elapsed = time.time() - started
        tip = 900123
        peers = [dict(id=i, addr=addr, network=network, subver='/Satoshi:28.1.0/', version=70016,
            inbound=i % 3 == 0, connection_type='inbound' if i % 3 == 0 else 'outbound-full-relay',
            transport_protocol_type='v2', conntime=now-3600*(i+1), pingtime=.018+i*.011,
            minping=.011, bytessent=1024**2*(i+1)*23, bytesrecv=1024**2*(i+1)*41,
            servicesnames=['NETWORK', 'WITNESS', 'NETWORK_LIMITED'], synced_blocks=tip, synced_headers=tip)
            for i, (addr, network) in enumerate([('192.0.2.12:8333','ipv4'),('198.51.100.8:8333','ipv4'),('[2001:db8::1]:8333','ipv6'),('203.0.113.21:8333','ipv4'),('testpeer.onion:8333','onion'),('192.0.2.32:8333','ipv4'),('[2001:db8::2]:8333','ipv6')])]
        responses = {
            'getblockchaininfo': dict(chain='main', blocks=tip, headers=tip, bestblockhash=f'{tip:064x}', difficulty=123.4e12, verificationprogress=.9999999, initialblockdownload=False, size_on_disk=682*1024**3, pruned=False, warnings=[]),
            'getnetworkinfo': dict(version=280100, subversion='/Satoshi:28.1.0/', protocolversion=70016, connections=7, connections_in=3, connections_out=4, networkactive=True, localservicesnames=['NETWORK','WITNESS'], warnings=[]),
            'getpeerinfo': peers,
            'getnettotals': dict(totalbytesrecv=int(384*1024**3+elapsed*240000), totalbytessent=int(112*1024**3+elapsed*90000), timemillis=int(time.time()*1000), uploadtarget=dict(timeframe=86400,target=0,target_reached=False,serve_historical_blocks=True,bytes_left_in_cycle=0,time_left_in_cycle=0)),
            'getmempoolinfo': dict(loaded=True,size=1842,bytes=7*1024**2,usage=22*1024**2,maxmempool=300*1024**2,total_fee=.18640212,mempoolminfee=.00001,minrelaytxfee=.00001),
            'uptime': int(18*86400+7*3600+elapsed),
        }
        if method == 'getnetworkhashps':
            result = 910e18 if req['params'][0] == 144 else 895e18
        elif method == 'estimatesmartfee':
            target = req['params'][0]
            result = dict(feerate={2: .00012, 3: .00008, 6: .00004}[target], blocks=target)
        elif method == 'getblockheader':
            height=int(req['params'][0],16)
            result=dict(hash=f'{height:064x}', height=height, time=now-180-(tip-height)*600, confirmations=tip-height+1, previousblockhash=f'{height-1:064x}')
        elif method == 'getblock':
            height=int(req['params'][0],16)
            result=dict(hash=req['params'][0], height=height, confirmations=tip-height+1, size=1750000, weight=3800000, nTx=2500 + (tip-height))
            result['previousblockhash'] = f'{height-1:064x}'
            if req['params'][1] == 1:
                result['tx'] = [f'{height*100000+i:064x}' for i in range(result['nTx'])]
            if req['params'][1] == 2:
                result['tx'] = [transaction(height, i) for i in range(result['nTx'])]
        elif method == 'getrawtransaction':
            height=int(req['params'][2],16)
            index=int(req['params'][0],16)-height*100000
            result=transaction(height,index)
        elif method == 'getblockstats':
            height=int(req['params'][0],16)
            result=dict(blockhash=req['params'][0], total_out=123456789012 + (tip-height)*100000000, txs=2500 + (tip-height), totalfee=12567890, feerate_percentiles=[1,3,8,25,40], subsidy=312500000, avgfeerate=12)
        else: result=responses[method]
        body=json.dumps(dict(jsonrpc='2.0', id=req['id'], result=result)).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

if __name__ == '__main__':
    FixtureServer(('127.0.0.1',19443),Handler).serve_forever()
