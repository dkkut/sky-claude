package online.skymessenger.app;

import android.content.ComponentName;
import android.content.pm.PackageManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Сменная иконка приложения: включает один из activity-alias (.IconClassic, .IconViolet …) и выключает остальные. */
@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {
    private static final String[] VARIANTS = {"classic", "violet", "ocean", "mint", "sunset", "rose", "gold"};

    @PluginMethod
    public void set(PluginCall call) {
        String name = call.getString("name");
        boolean known = false;
        for (String v : VARIANTS) { if (v.equals(name)) { known = true; break; } }
        if (!known) { call.reject("unknown_icon"); return; }
        PackageManager pm = getContext().getPackageManager();
        String pkg = getContext().getPackageName();
        try {
            // Сначала включаем нужный, потом выключаем остальные: иконка не пропадает ни на миг.
            for (String v : VARIANTS) {
                if (v.equals(name)) setState(pm, pkg, v, true);
            }
            for (String v : VARIANTS) {
                if (!v.equals(name)) setState(pm, pkg, v, false);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("icon_switch_failed");
        }
    }

    private void setState(PackageManager pm, String pkg, String variant, boolean enabled) {
        String alias = "online.skymessenger.app.Icon" + Character.toUpperCase(variant.charAt(0)) + variant.substring(1);
        pm.setComponentEnabledSetting(
            new ComponentName(pkg, alias),
            enabled ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP);
    }
}
