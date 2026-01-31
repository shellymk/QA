#!/usr/bin/env python3
"""
Módulo de Testes de Performance
Realiza testes de carga, stress, spike e endurance em sistemas web
"""
import time
import requests
import statistics
import concurrent.futures
from typing import List, Dict, Any, Callable
from dataclasses import dataclass, field
from datetime import datetime
import json

import urllib3
# Desabilita avisos de SSL inseguro (comum em ambientes de teste)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ============================================================================
# NOTA: Não mexemos no sys.stdout aqui. 
# O run_tests.py já configurou o LogBlindado para proteger contra erros.
# ============================================================================

@dataclass
class RequestResult:
    """Resultado de uma requisição individual"""
    url: str
    method: str
    status_code: int
    response_time: float  # em milissegundos
    success: bool
    error: str = None
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class TestMetrics:
    """Métricas agregadas de um teste"""
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    total_duration: float = 0.0
    
    response_times: List[float] = field(default_factory=list)
    
    @property
    def success_rate(self) -> float:
        if self.total_requests == 0:
            return 0.0
        return (self.successful_requests / self.total_requests) * 100
    
    @property
    def error_rate(self) -> float:
        if self.total_requests == 0:
            return 0.0
        return (self.failed_requests / self.total_requests) * 100
    
    @property
    def avg_response_time(self) -> float:
        if not self.response_times:
            return 0.0
        return statistics.mean(self.response_times)
    
    @property
    def min_response_time(self) -> float:
        if not self.response_times:
            return 0.0
        return min(self.response_times)
    
    @property
    def max_response_time(self) -> float:
        if not self.response_times:
            return 0.0
        return max(self.response_times)
    
    @property
    def p50_response_time(self) -> float:
        if not self.response_times:
            return 0.0
        return statistics.median(self.response_times)
    
    @property
    def p95_response_time(self) -> float:
        if not self.response_times:
            return 0.0
        sorted_times = sorted(self.response_times)
        index = int(len(sorted_times) * 0.95)
        return sorted_times[index] if index < len(sorted_times) else sorted_times[-1]
    
    @property
    def p99_response_time(self) -> float:
        if not self.response_times:
            return 0.0
        sorted_times = sorted(self.response_times)
        index = int(len(sorted_times) * 0.99)
        return sorted_times[index] if index < len(sorted_times) else sorted_times[-1]
    
    @property
    def requests_per_second(self) -> float:
        if self.total_duration == 0:
            return 0.0
        return self.total_requests / self.total_duration
    
    def to_dict(self) -> Dict[str, Any]:
        """Converte métricas para dicionário"""
        return {
            'total_requests': self.total_requests,
            'successful_requests': self.successful_requests,
            'failed_requests': self.failed_requests,
            'success_rate': round(self.success_rate, 2),
            'error_rate': round(self.error_rate, 4),
            'total_duration': round(self.total_duration, 2),
            'requests_per_second': round(self.requests_per_second, 2),
            'response_times': {
                'avg': round(self.avg_response_time, 2),
                'min': round(self.min_response_time, 2),
                'max': round(self.max_response_time, 2),
                'p50': round(self.p50_response_time, 2),
                'p95': round(self.p95_response_time, 2),
                'p99': round(self.p99_response_time, 2)
            }
        }


class PerformanceTester:
    """Classe principal para testes de performance"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.target = config.get('target', {})
        self.perf_config = config.get('performance', {})
        self.timeout = config.get('general', {}).get('timeout', 30)
        self.session = requests.Session()
        
    def _make_request(self, url: str, method: str = 'GET', **kwargs) -> RequestResult:
        """Realiza uma requisição HTTP e mede o tempo de resposta"""
        start_time = time.time()
        
        try:
            response = self.session.request(
                method=method,
                url=url,
                timeout=self.timeout,
                verify=False,
                **kwargs
            )
            
            response_time = (time.time() - start_time) * 1000  # converter para ms
            
            return RequestResult(
                url=url,
                method=method,
                status_code=response.status_code,
                response_time=response_time,
                success=response.status_code < 400
            )
            
        except Exception as e:
            response_time = (time.time() - start_time) * 1000
            return RequestResult(
                url=url,
                method=method,
                status_code=0,
                response_time=response_time,
                success=False,
                error=str(e)
            )
    
    def _simulate_user(self, endpoints: List[str], duration: float = None, 
                       request_count: int = None) -> List[RequestResult]:
        """Simula um usuário fazendo requisições"""
        results = []
        start_time = time.time()
        request_num = 0
        
        while True:
            # Verifica condições de parada
            if duration and (time.time() - start_time) >= duration:
                break
            if request_count and request_num >= request_count:
                break
            
            # Faz requisição para cada endpoint
            for endpoint in endpoints:
                url = f"{self.target['base_url']}{endpoint}"
                result = self._make_request(url)
                results.append(result)
                request_num += 1
                
                # Pequeno delay entre requisições (simula comportamento real)
                time.sleep(0.1)
            
            if not duration and not request_count:
                break  # Evita loop infinito
        
        return results
    
    def _aggregate_results(self, results: List[RequestResult], 
                           duration: float) -> TestMetrics:
        """Agrega resultados de múltiplas requisições"""
        metrics = TestMetrics()
        metrics.total_requests = len(results)
        metrics.total_duration = duration
        
        for result in results:
            if result.success:
                metrics.successful_requests += 1
            else:
                metrics.failed_requests += 1
            
            metrics.response_times.append(result.response_time)
        
        return metrics
    
    def load_test(self) -> Dict[str, Any]:
        """
        Teste de Carga: Simula um número constante de usuários
        """
        print("\n[PERFORMANCE] Iniciando Teste de Carga...")
        
        load_config = self.perf_config.get('load_test', {})
        if not load_config.get('enabled', True):
            return {'skipped': True, 'reason': 'Teste desabilitado na configuração'}
        
        users = load_config.get('users', 100)
        duration = load_config.get('duration', 60)
        ramp_up = load_config.get('ramp_up', 10)
        
        endpoints = self.target.get('api_endpoints', ['/'])
        
        print(f"  Usuários: {users}")
        print(f"  Duração: {duration}s")
        print(f"  Ramp-up: {ramp_up}s")
        
        all_results = []
        start_time = time.time()
        
        # Implementa ramp-up gradual
        users_per_batch = max(1, users // (ramp_up if ramp_up > 0 else 1))
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=users) as executor:
            futures = []
            
            for i in range(users):
                # Adiciona delay para ramp-up
                if ramp_up > 0 and i > 0 and i % users_per_batch == 0:
                    time.sleep(ramp_up / (users // users_per_batch))
                
                future = executor.submit(
                    self._simulate_user,
                    endpoints,
                    duration=duration
                )
                futures.append(future)
            
            # Coleta resultados
            for future in concurrent.futures.as_completed(futures):
                try:
                    results = future.result()
                    all_results.extend(results)
                except Exception as e:
                    print(f"  Erro em thread: {e}")
        
        total_duration = time.time() - start_time
        metrics = self._aggregate_results(all_results, total_duration)
        
        print(f"  ✓ Teste concluído: {metrics.total_requests} requisições em {total_duration:.2f}s")
        print(f"  Taxa de sucesso: {metrics.success_rate:.2f}%")
        print(f"  Tempo médio de resposta: {metrics.avg_response_time:.2f}ms")
        
        return {
            'test_type': 'load_test',
            'config': load_config,
            'metrics': metrics.to_dict(),
            'timestamp': datetime.now().isoformat()
        }
    
    def stress_test(self) -> Dict[str, Any]:
        """
        Teste de Stress: Aumenta gradualmente o número de usuários
        """
        print("\n[PERFORMANCE] Iniciando Teste de Stress...")
        
        stress_config = self.perf_config.get('stress_test', {})
        if not stress_config.get('enabled', True):
            return {'skipped': True, 'reason': 'Teste desabilitado na configuração'}
        
        start_users = stress_config.get('start_users', 10)
        max_users = stress_config.get('max_users', 500)
        step_users = stress_config.get('step_users', 50)
        step_duration = stress_config.get('step_duration', 30)
        
        endpoints = self.target.get('api_endpoints', ['/'])
        
        print(f"  Usuários iniciais: {start_users}")
        print(f"  Usuários máximos: {max_users}")
        print(f"  Incremento: {step_users}")
        
        results_by_step = []
        
        for current_users in range(start_users, max_users + 1, step_users):
            print(f"\n  Testando com {current_users} usuários...")
            
            all_results = []
            start_time = time.time()
            
            with concurrent.futures.ThreadPoolExecutor(max_workers=current_users) as executor:
                futures = [
                    executor.submit(self._simulate_user, endpoints, duration=step_duration)
                    for _ in range(current_users)
                ]
                
                for future in concurrent.futures.as_completed(futures):
                    try:
                        results = future.result()
                        all_results.extend(results)
                    except Exception as e:
                        print(f"    Erro: {e}")
            
            total_duration = time.time() - start_time
            metrics = self._aggregate_results(all_results, total_duration)
            
            step_result = {
                'users': current_users,
                'metrics': metrics.to_dict()
            }
            results_by_step.append(step_result)
            
            print(f"    Taxa de sucesso: {metrics.success_rate:.2f}%")
            print(f"    Tempo médio: {metrics.avg_response_time:.2f}ms")
            print(f"    RPS: {metrics.requests_per_second:.2f}")
            
            # Verifica se o sistema está degradando significativamente
            if metrics.error_rate > 10 or metrics.p95_response_time > 5000:
                print(f"  ⚠ Sistema sob stress significativo com {current_users} usuários")
                break
        
        return {
            'test_type': 'stress_test',
            'config': stress_config,
            'results_by_step': results_by_step,
            'timestamp': datetime.now().isoformat()
        }
    
    def spike_test(self) -> Dict[str, Any]:
        """
        Teste de Spike: Simula um aumento súbito de carga
        """
        print("\n[PERFORMANCE] Iniciando Teste de Spike...")
        
        spike_config = self.perf_config.get('spike_test', {})
        if not spike_config.get('enabled', True):
            return {'skipped': True, 'reason': 'Teste desabilitado na configuração'}
        
        normal_users = spike_config.get('normal_users', 10)
        spike_users = spike_config.get('spike_users', 500)
        spike_duration = spike_config.get('spike_duration', 10)
        
        endpoints = self.target.get('api_endpoints', ['/'])
        
        print(f"  Carga normal: {normal_users} usuários")
        print(f"  Spike: {spike_users} usuários por {spike_duration}s")
        
        # Fase 1: Carga normal (baseline)
        print("\n  Fase 1: Estabelecendo baseline...")
        baseline_results = []
        start_time = time.time()
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=normal_users) as executor:
            futures = [
                executor.submit(self._simulate_user, endpoints, duration=10)
                for _ in range(normal_users)
            ]
            for future in concurrent.futures.as_completed(futures):
                baseline_results.extend(future.result())
        
        baseline_duration = time.time() - start_time
        baseline_metrics = self._aggregate_results(baseline_results, baseline_duration)
        
        # Fase 2: Spike
        print(f"  Fase 2: Aplicando spike de {spike_users} usuários...")
        spike_results = []
        start_time = time.time()
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=spike_users) as executor:
            futures = [
                executor.submit(self._simulate_user, endpoints, duration=spike_duration)
                for _ in range(spike_users)
            ]
            for future in concurrent.futures.as_completed(futures):
                spike_results.extend(future.result())
        
        spike_duration_actual = time.time() - start_time
        spike_metrics = self._aggregate_results(spike_results, spike_duration_actual)
        
        # Fase 3: Recuperação
        print("  Fase 3: Medindo recuperação...")
        recovery_results = []
        start_time = time.time()
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=normal_users) as executor:
            futures = [
                executor.submit(self._simulate_user, endpoints, duration=10)
                for _ in range(normal_users)
            ]
            for future in concurrent.futures.as_completed(futures):
                recovery_results.extend(future.result())
        
        recovery_duration = time.time() - start_time
        recovery_metrics = self._aggregate_results(recovery_results, recovery_duration)
        
        print(f"\n  Baseline: {baseline_metrics.avg_response_time:.2f}ms avg")
        print(f"  Spike: {spike_metrics.avg_response_time:.2f}ms avg")
        print(f"  Recuperação: {recovery_metrics.avg_response_time:.2f}ms avg")
        
        return {
            'test_type': 'spike_test',
            'config': spike_config,
            'baseline': baseline_metrics.to_dict(),
            'spike': spike_metrics.to_dict(),
            'recovery': recovery_metrics.to_dict(),
            'timestamp': datetime.now().isoformat()
        }
    
    def run_all_tests(self) -> Dict[str, Any]:
        """Executa todos os testes de performance habilitados"""
        results = {
            'test_suite': 'performance',
            'target': self.target,
            'start_time': datetime.now().isoformat(),
            'tests': {}
        }
        
        # Load Test
        if self.perf_config.get('load_test', {}).get('enabled', True):
            results['tests']['load_test'] = self.load_test()
        
        # Stress Test
        if self.perf_config.get('stress_test', {}).get('enabled', True):
            results['tests']['stress_test'] = self.stress_test()
        
        # Spike Test
        if self.perf_config.get('spike_test', {}).get('enabled', True):
            results['tests']['spike_test'] = self.spike_test()
        
        results['end_time'] = datetime.now().isoformat()
        
        return results


if __name__ == '__main__':
    # Exemplo de uso standalone
    print("Execute pelo run_tests.py para integração completa.")