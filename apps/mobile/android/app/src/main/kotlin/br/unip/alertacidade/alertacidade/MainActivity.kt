package br.unip.alertacidade.alertacidade

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createAlertsChannel()
    }

    /**
     * Canal "alertas" (Android 8+): as notificações de alagamento usam importância alta
     * para aparecer no topo da tela. O worker envia com channelId = "alertas" e o manifesto
     * declara este canal como padrão do FCM. Criar um canal que já existe não altera nada.
     */
    private fun createAlertsChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            "alertas",
            "Alertas de alagamento",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Ocorrências próximas da sua área de interesse e atualizações dos seus registros."
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
}
