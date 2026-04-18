<?php

// pfSense includes
require_once('functions.inc');
require_once('config.inc');
// require_once('globals.inc');
// require_once('gwlb.inc');
// require_once('util.inc');
// require_once('services.inc');
// require_once('service-utils.inc');

// Amnezia WireGuard includes
require_once('amneziawireguard/includes/wg.inc');
require_once('amneziawireguard/includes/wg_guiconfig.inc');

header("Content-Type: application/json");
define('AMNEZIAWG_BASE_PATH', 'installedpackages/amneziawg');
// Grab current configuration from the XML
$pconfig = config_get_path(AMNEZIAWG_BASE_PATH . '/api', []);

//ignore_user_abort(true);

$apiConfig = getAPIConfig();
if (empty($apiConfig)) {
    $defaultConfig = [
        "api_enable" => true,
    ];
    saveAPIConfig($defaultConfig);
}
function saveAPIConfig($configData)
{
    global $config;

    if (!is_array($config['installedpackages'])) {
        $config['installedpackages'] = [];
    }

    if (!is_array($config['installedpackages']['amneziawg'])) {
        $config['installedpackages']['amneziawg'] = [];
    }

    if (!is_array($config['installedpackages']['amneziawg']['api'])) {
        $config['installedpackages']['amneziawg']['api'] = [];
    }

    $config['installedpackages']['amneziawg']['api'] = $configData;

    write_config("Updated AmneziaWireGuard API configuration");
}

function getAPIConfig()
{
    global $config;

    return $config['installedpackages']['amneziawg']['api'] ?? [];
}
function respond($status, $data = '', $message = '')
{
    http_response_code($status);
    $response = [];
    if (!empty($data)) {
        $response['data'] = $data;
    }
    if (!empty($message)) {
        $response['message'] = $message;
    }
    echo json_encode($response);
    exit;
}

// function getPublicIP()
// {
//     // Array of reliable IP detection services with fallback
//     $ip_services = [
//         'https://ifconfig.me',
//         'https://ipinfo.io/ip',
//         'https://icanhazip.com',
//         'https://checkip.amazonaws.com',
//         'https://ipecho.net/plain',
//         'https://myexternalip.com/raw'
//     ];
    
//     foreach ($ip_services as $service) {
//         $curl_output = shell_exec("timeout 1 curl -s --max-time 5 " . escapeshellarg($service));
//         if ($curl_output !== null) {
//             $potential_ip = trim($curl_output);
//             // Validate IP format
//             if (filter_var($potential_ip, FILTER_VALIDATE_IP)) {
//                 return $potential_ip;
//             }
//         }
//     }
    
//     // If all services fail, return a default message
//     return 'Unable to determine';
// }

function authenticate($apiKey)
{
    $providedKey = "";
    
    // BUG FIX: Check if API key header exists first
    if (isset($_SERVER['HTTP_X_API_KEY'])) {
        $providedKey = $_SERVER['HTTP_X_API_KEY'];
    }
    
    // BUG FIX: Check if API key is empty AFTER getting it from header
    if (empty($providedKey)) {
        respond(401, '', "Unauthorized: API Key is required");
    }

    $apiConfig = getAPIConfig();

    // Check if API is enabled
    if (empty($apiConfig['api_enable']) || $apiConfig['api_enable'] !== 'yes') {
        respond(403, '', "API is disabled");
    }

    // Check authentication method
    $authMethod = $apiConfig['auth_method'] ?? 'none';

    switch ($authMethod) {
        case 'apikey':
            $configuredKey = $apiConfig['api_key'] ?? '';
            // BUG FIX: Add length check to prevent timing attacks
            if (empty($configuredKey) || strlen(trim($providedKey)) !== strlen(trim($configuredKey)) || trim($providedKey) !== trim($configuredKey)) {
                respond(401, '', "Unauthorized: Invalid API Key");
            }
            break;

        case 'none':
            // No authentication required
            break;

        default:
            respond(400, '', "Invalid authentication method");
    }
}

function parsePeer($peer)
{
    // BUG FIX: Add null checks and proper array handling
    if (!is_array($peer)) {
        return null;
    }
    
    return [
        'id' => htmlspecialchars($peer['id'] ?? ''),
        'description' => htmlspecialchars($peer['descr'] ?? ''),
        'public_key' => htmlspecialchars($peer['publickey'] ?? ''),
        'private_key' => htmlspecialchars($peer['privatekey'] ?? ''),
        'tunnel' => htmlspecialchars($peer['tun'] ?? ''),
        'allowed_ips' => array_map(function ($ip) {
            // BUG FIX: Add validation for IP array structure
            if (!is_array($ip) || !isset($ip['address']) || !isset($ip['mask'])) {
                return '';
            }
            return "{$ip['address']}/{$ip['mask']}";
        }, $peer['allowedips']['row'] ?? []),
        'endpoint' => htmlspecialchars(wg_format_endpoint(false, $peer)),
        'enabled' => !empty($peer['enabled']) && strtolower(trim($peer['enabled'])) === 'yes',
    ];
}

function parseTunnel($tunnel)
{
    // BUG FIX: Add null checks and validation
    if (!is_array($tunnel) || empty($tunnel['name'])) {
        return null;
    }
    
    $peers = wg_tunnel_get_peers_config($tunnel['name']);
    
    // Get endpoint and DNS from API config or auto-detect
    $api_config = config_get_path('installedpackages/amneziawg/api', []);
    $endpoint_ip = !empty($api_config['endpoint_override']) ? $api_config['endpoint_override'] : getPublicIP();
    
    // Process DNS servers if provided
    $dns_servers = [];
    if (!empty($api_config['dns_servers'])) {
        $dns_servers = array_map('trim', explode(',', trim($api_config['dns_servers'])));
        $dns_servers = array_filter($dns_servers); // Remove empty values
    }
    
    return [
        'name' => htmlspecialchars($tunnel['name']),
        'description' => htmlspecialchars($tunnel['descr'] ?? ''),
        'public_key' => htmlspecialchars($tunnel['publickey'] ?? ''),
        'address' => array_map(function ($ip) {
            // BUG FIX: Add validation for IP array structure
            if (!is_array($ip) || !isset($ip['address']) || !isset($ip['mask'])) {
                return '';
            }
            return "{$ip['address']}/{$ip['mask']}";
        }, $tunnel['addresses']['row'] ?? []),
        'public_ip' => $endpoint_ip,
        'listen_port' => htmlspecialchars($tunnel['listenport'] ?? ''),
        'dns' => $dns_servers,
        
        'config' => [
            'jc' => intval($tunnel['jc'] ?? 0),
            'jmin' => intval($tunnel['jmin'] ?? 0),
            'jmax' => intval($tunnel['jmax'] ?? 0),
            's1' => intval($tunnel['s1'] ?? 0),
            's2' => intval($tunnel['s2'] ?? 0),
            'h1' => intval($tunnel['h1'] ?? 0),
            'h2' => intval($tunnel['h2'] ?? 0),
            'h3' => intval($tunnel['h3'] ?? 0),
            'h4' => intval($tunnel['h4'] ?? 0),
        ],
        
        'peer_count' => is_array($peers) ? count($peers) : 0,
        'enabled' => !empty($tunnel['enabled']) && strtolower(trim($tunnel['enabled'])) === 'yes',
    ];
}


function listPeers()
{
    $peers = config_get_path(AMNEZIAWG_BASE_PATH . '/peers/item', []);

    if (count($peers) > 0) {
        $peerList = [];
        foreach ($peers as $peer) {
            $peerList[] = parsePeer($peer);
        }
        return $peerList;
    } else {
        respond(200, '', 'No peers have been configured.');
    }
}

function syncPeers($peers, $tunnel = null)
{
    global $config;

    // BUG FIX: Add input validation
    if (!is_array($peers)) {
        respond(400, '', "Peers must be an array");
    }

    $peersPath = AMNEZIAWG_BASE_PATH . '/peers/item';
    $existingPeers = config_get_path($peersPath, []);

    // If tunnel is null or 'all', sync to all tunnels
    if ($tunnel === null || $tunnel === 'all') {
        return syncPeersToAllTunnels($peers);
    }

    // BUG FIX: Validate tunnel name
    if (empty($tunnel) || !is_string($tunnel)) {
        respond(400, '', "Invalid tunnel name");
    }

    // Original single tunnel sync logic
    // Create a map of existing peers by public key for quick lookup
    $existingPeersMap = [];
    foreach ($existingPeers as $peer) {
        if ($peer['tun'] === $tunnel) {
            $existingPeersMap[$peer['publickey']] = $peer;
        }
    }

    // Prepare the new list of peers for the specified tunnel
    $newPeers = [];
    foreach ($existingPeers as $peer) {
        if ($peer['tun'] !== $tunnel) {
            // Keep peers that belong to other tunnels unchanged
            $newPeers[] = $peer;
        }
    }

    foreach ($peers as $peer) {
        // BUG FIX: Add comprehensive validation
        if (!is_array($peer)) {
            respond(400, '', "Each peer must be an array");
        }
        
        if (empty($peer['public_key']) || empty($peer['description'])) {
            respond(400, '', "Invalid peer data: public_key and description are required");
        }

        // BUG FIX: Validate public key format (basic check)
        if (!preg_match('/^[A-Za-z0-9+\/]{43}=$/', $peer['public_key'])) {
            respond(400, '', "Invalid public key format");
        }

        $allowedIps = [];
        if (!empty($peer['allowed_ips']) && is_array($peer['allowed_ips'])) {
            foreach ($peer['allowed_ips'] as $ip) {
                // BUG FIX: Validate IP/CIDR format more thoroughly
                if (!is_string($ip) || strpos($ip, '/') === false) {
                    respond(400, '', "Invalid allowed IP format: {$ip}");
                }
                
                $parts = explode('/', $ip);
                if (count($parts) !== 2) {
                    respond(400, '', "Invalid CIDR format: {$ip}");
                }
                
                $ipAddr = trim($parts[0]);
                $mask = trim($parts[1]);
                
                // Validate IP address
                if (!filter_var($ipAddr, FILTER_VALIDATE_IP)) {
                    respond(400, '', "Invalid IP address: {$ipAddr}");
                }
                
                // Validate CIDR mask
                if (!is_numeric($mask) || $mask < 0 || $mask > 32) {
                    respond(400, '', "Invalid CIDR mask: {$mask}");
                }
                
                $allowedIps[] = ['address' => $ipAddr, 'mask' => $mask];
            }
        }

        $newPeers[] = [
            'id' => $existingPeersMap[$peer['public_key']]['id'] ?? wg_generate_uuid(),
            'enabled' => 'yes',
            'tun' => $tunnel,
            'descr' => $peer['description'],
            'publickey' => $peer['public_key'],
            'privatekey' => $existingPeersMap[$peer['public_key']]['privatekey'] ?? '',
            'allowedips' => ['row' => $allowedIps],
            'endpoint' => '',
            'port' => $existingPeersMap[$peer['public_key']]['port'] ?? '',
            'persistentkeepalive' => $existingPeersMap[$peer['public_key']]['persistentkeepalive'] ?? '30',
            'presharedkey' => $existingPeersMap[$peer['public_key']]['presharedkey'] ?? '',
        ];
    }

    // Replace the peers configuration with the updated list
    config_set_path($peersPath, $newPeers);

    // Save the configuration
    write_config("Synced peers for tunnel {$tunnel}");

    // Resync the package
    wg_resync();

    // BUG FIX: Add error handling for sync operations
    try {
        if (wg_is_service_running() && wg_is_service_enabled()) {
            $tunnels_to_apply = wg_apply_list_get('tunnels');
            $sync_status = wg_tunnel_sync($tunnels_to_apply, true, true);
        } else {
            $sync_status = "Service not running";
        }
    } catch (Exception $e) {
        respond(500, '', "Sync failed: " . $e->getMessage());
    }

    respond(200, listPeers(), "Peers synced successfully {$sync_status}");
}

function syncPeersToAllTunnels($peers)
{
    global $config;

    $peersPath = AMNEZIAWG_BASE_PATH . '/peers/item';
    $tunnelsPath = AMNEZIAWG_BASE_PATH . '/tunnels/item';
    
    $existingPeers = config_get_path($peersPath, []);
    $tunnels = config_get_path($tunnelsPath, []);

    if (empty($tunnels)) {
        respond(400, '', "No tunnels found to sync peers to");
    }

    // Create a map of existing peers by public key for quick lookup
    $existingPeersMap = [];
    foreach ($existingPeers as $peer) {
        $existingPeersMap[$peer['publickey']] = $peer;
    }

    // Clear all existing peers (we'll rebuild the entire list)
    $newPeers = [];

    // For each tunnel, add all the provided peers
    foreach ($tunnels as $tunnel) {
        $tunnelName = $tunnel['name'];
        
        foreach ($peers as $peer) {
            if (empty($peer['public_key']) || empty($peer['description']) || empty($peer['update_date'])) {
                respond(400, '', "Invalid peer data: public_key, description, and update_date are required");
            }

            $allowedIps = [];
            if (!empty($peer['allowed_ips']) && is_array($peer['allowed_ips'])) {
                foreach ($peer['allowed_ips'] as $ip) {
                    if (strpos($ip, '/') === false) {
                        respond(400, '', "Invalid allowed IP format: {$ip}");
                    }
                    $allowedIps[] = ['address' => explode('/', $ip)[0], 'mask' => explode('/', $ip)[1]];
                }
            }

            // Generate a unique ID for each peer-tunnel combination
            $peerTunnelKey = $peer['public_key'] . '_' . $tunnelName;
            $existingPeerForTunnel = null;
            
            // Look for existing peer for this specific tunnel
            foreach ($existingPeers as $existingPeer) {
                if ($existingPeer['publickey'] === $peer['public_key'] && $existingPeer['tun'] === $tunnelName) {
                    $existingPeerForTunnel = $existingPeer;
                    break;
                }
            }

            $newPeers[] = [
                'id' => $existingPeerForTunnel['id'] ?? wg_generate_uuid(),
                'enabled' => isset($peer['enabled']) && $peer['enabled'] ? 'yes' : 'no',
                'tun' => $tunnelName,
                'descr' => $peer['description'],
                'publickey' => $peer['public_key'],
                'privatekey' => $existingPeerForTunnel['privatekey'] ?? $existingPeersMap[$peer['public_key']]['privatekey'] ?? '',
                'allowedips' => ['row' => $allowedIps],
                'endpoint' => $existingPeerForTunnel['endpoint'] ?? '',
                'port' => $existingPeerForTunnel['port'] ?? $existingPeersMap[$peer['public_key']]['port'] ?? '',
                'persistentkeepalive' => $existingPeerForTunnel['persistentkeepalive'] ?? $existingPeersMap[$peer['public_key']]['persistentkeepalive'] ?? '30',
                'presharedkey' => $existingPeerForTunnel['presharedkey'] ?? $existingPeersMap[$peer['public_key']]['presharedkey'] ?? '',
            ];
        }
    }

    // Replace the peers configuration with the updated list
    config_set_path($peersPath, $newPeers);

    // Save the configuration
    write_config("Synced peers to all tunnels");

    // Resync the package (regenerates .conf files on disk)
    wg_resync();

    // For peer-only changes we only need wg_wg_if_sync() per tunnel —
    // avoids the expensive system_routing_configure() + filter_configure()
    // and the double wg_resync() that wg_tunnel_sync() would trigger.
    if (wg_is_service_running() && wg_is_service_enabled()) {
        foreach ($tunnels as $tunnel) {
            wg_wg_if_sync($tunnel['name']);
        }
    }

    $tunnelNames = array_map(function($t) { return $t['name']; }, $tunnels);
    respond(200, listPeers(), "Peers synced successfully to all tunnels: " . implode(', ', $tunnelNames));
}

function listTunnels()
{
    $tunnels = config_get_path(AMNEZIAWG_BASE_PATH . '/tunnels/item', []);

    if (count($tunnels) > 0) {
        $tunnelList = [];
        foreach ($tunnels as $tunnel) {
            $tunnelList[] = parseTunnel($tunnel);
        }
        return $tunnelList;
    } else {
        respond(200, '', 'No tunnels have been configured.');
    }
}

function getConnectedPeers()
{
    // Get the running status of all tunnels and their peers
    $devices_status = wg_get_status();
    
    if (empty($devices_status)) {
        respond(200, [], 'No active tunnels or connected peers found.');
    }
    
    // Map to track each tunnel and its connected peers
    $tunnels_map = [];
    
    // Iterate through all tunnels and their peers
    foreach ($devices_status as $tunnel_name => $tunnel_data) {
        if (empty($tunnel_data['peers'])) {
            continue;
        }

        // Initialize tunnel entry if it does not exist yet
        if (!isset($tunnels_map[$tunnel_name])) {
            $tunnels_map[$tunnel_name] = [
                'tunnel' => htmlspecialchars($tunnel_name),
                'peers' => [],
            ];
        }

        foreach ($tunnel_data['peers'] as $peer_public_key => $peer_data) {
            $latest_handshake = intval($peer_data['latest_handshake'] ?? 0);

            $tunnels_map[$tunnel_name]['peers'][] = [
                'public_key' => htmlspecialchars($peer_public_key),
                'description' => htmlspecialchars($peer_data['config']['descr'] ?? ''),
                'latest_handshake' => $latest_handshake,
                'latest_handshake_human' => wg_human_time_diff("@{$latest_handshake}"),
            ];
        }
    }
    
    // Add total peers count for each tunnel
    foreach ($tunnels_map as $tunnel_name => &$tunnel_info) {
        $tunnel_info['total_peers'] = is_array($tunnel_info['peers']) ? count($tunnel_info['peers']) : 0;
    }
    unset($tunnel_info);

    // Convert the map to an indexed array for the response
    $connected_peers = array_values($tunnels_map);
    
    return $connected_peers;
}



function addPeer($peerData)
{
    global $config;

    $peersPath = AMNEZIAWG_BASE_PATH . '/peers/item';
    $peers = config_get_path($peersPath, []);

    // Generate a UUID for the new peer
    $peerData['id'] = wg_generate_uuid();

    // Validate required fields
    $requiredFields = ['tun', 'publickey', 'privatekey'];
    foreach ($requiredFields as $field) {
        if (empty($peerData[$field])) {
            respond(400, '', "Missing required field: $field");
        }
    }

    // Prepare peer configuration
    $peerConfig = [
        'id' => $peerData['id'],
        'enabled' => isset($peerData['enabled']) && $peerData['enabled'] ? 'yes' : 'no',
        'tun' => $peerData['tun'],
        'descr' => $peerData['descr'] ?? '',
        'endpoint' => $peerData['endpoint'] ?? '',
        'port' => $peerData['port'] ?? '',
        'persistentkeepalive' => $peerData['persistentkeepalive'] ?? '',
        'privatekey' => $peerData['privatekey'],
        'publickey' => $peerData['publickey'],
        'presharedkey' => $peerData['presharedkey'] ?? '',
        'allowedips' => [
            'row' => $peerData['allowedips'] ?? [],
        ],
    ];

    // Add the new peer to the configuration
    $peers[] = $peerConfig;
    config_set_path($peersPath, $peers);

    // Save the configuration
    write_config("Added new peer with ID {$peerData['id']}");

    // Resync the package
    wg_resync();

    respond(200, $peerConfig, "Peer added successfully");
}


    
function getInputData()
{
    $input = $_POST;
    if (empty($input)) {
        respond(400, '', "No POST data received");
    }
    return $input;
}



function getJsonInputData()
{
    $input = file_get_contents('php://input');
    
    // BUG FIX: Handle empty input gracefully
    if ($input === false || $input === '') {
        return [];
    }
    
    $data = json_decode($input, true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        respond(400, '', "Invalid JSON input: " . json_last_error_msg());
    }

    // BUG FIX: Return empty array instead of responding with error for empty data
    return $data ?? [];
}

function getHttpVariables()
{
    $httpVariables = [
        'GET' => $_GET,
        'POST' => $_POST,
        'PUT' => getJsonInputData(),
        'SERVER' => $_SERVER,
        'FILES' => $_FILES,
        'COOKIE' => $_COOKIE,
        'REQUEST' => $_REQUEST,
        'SESSION' => isset($_SESSION) ? $_SESSION : null,
        'ENV' => $_ENV,
    ];
    respond(200, $httpVariables);

}

function addTunnel($tunnelData, $overwrite = false)
{
    global $config;

    // BUG FIX: Validate input is array
    if (!is_array($tunnelData)) {
        respond(400, '', "Tunnel data must be an array");
    }

    $tunnelsPath = AMNEZIAWG_BASE_PATH . '/tunnels/item';
    $tunnels = config_get_path($tunnelsPath, []);

    // Validate required fields
    $requiredFields = ['name', 'descr', 'listenport', 'addresses'];
    foreach ($requiredFields as $field) {
        if (empty($tunnelData[$field])) {
            respond(400, '', "Missing required field: $field");
        }
    }

    // BUG FIX: Validate tunnel name format and length
    if (!preg_match('/^[a-zA-Z0-9_-]+$/', $tunnelData['name'])) {
        respond(400, '', "Invalid tunnel name format. Use only alphanumeric characters, hyphens, and underscores.");
    }

    // Linux kernel interface name limit is 15 characters
    if (strlen($tunnelData['name']) > 15) {
        respond(400, '', "Tunnel name exceeds 15 character limit. Current length: " . strlen($tunnelData['name']));
    }

    // BUG FIX: Validate listen port
    $port = intval($tunnelData['listenport']);
    if ($port < 1 || $port > 65535) {
        respond(400, '', "Invalid listen port. Must be between 1 and 65535.");
    }

    // BUG FIX: Validate addresses format
    if (!is_array($tunnelData['addresses'])) {
        respond(400, '', "Addresses must be an array");
    }

    foreach ($tunnelData['addresses'] as $addr) {
        if (!is_array($addr) || !isset($addr['address']) || !isset($addr['mask'])) {
            respond(400, '', "Invalid address format");
        }
        
        if (!filter_var($addr['address'], FILTER_VALIDATE_IP)) {
            respond(400, '', "Invalid IP address: " . $addr['address']);
        }
        
        $mask = intval($addr['mask']);
        if ($mask < 0 || $mask > 32) {
            respond(400, '', "Invalid subnet mask: " . $addr['mask']);
        }
    }

    foreach ($tunnels as $index => $existingTunnel) {
        if ($existingTunnel['name'] === $tunnelData['name']) {
            if ($overwrite) {
                // If overwrite is true, update the existing tunnel
                $editData = $tunnelData;
                // Ensure required fields are present
                $editData['name'] = $existingTunnel['name'];
                editTunnel($editData);
                // editTunnel will exit via respond()
            } else {
                // Tunnel with this name already exists, do not replace
                respond(400, '', "Tunnel with name {$tunnelData['name']} already exists");
            }
        }
    }

    // Generate keypair using internal function
    $keypair = wg_gen_keypair();

    // Prepare tunnel configuration
    $tunnelConfig = [
        'name' => $tunnelData['name'],
        'descr' => $tunnelData['descr'] ?? '',
        'publickey' => $keypair['pubkey'],
        'privatekey' => $keypair['privkey'],
        'addresses' => [
            'row' => $tunnelData['addresses'],
        ],
        'listenport' => $tunnelData['listenport'] ?? '',
        'enabled' => isset($tunnelData['enabled']) && $tunnelData['enabled'] ? 'yes' : 'no'
    ];


    // Generate default values for amnezia wireguard and directly add them to $tunnelConfig
    $tunnelConfig['jc'] = rand(3, 10);
    $tunnelConfig['jmin'] = $jmin = rand(10, 300);
    $tunnelConfig['jmax'] = rand($jmin + 1, $jmin + 570);

    $tunnelConfig['s1'] = rand(3, 127);
    $tunnelConfig['s2'] = rand(3, 127);

    $min = 0x10000011;
    $max = 0x7FFFFF00;
    $tunnelConfig['h1'] = rand($min, $max);
    $tunnelConfig['h2'] = rand($min, $max);
    $tunnelConfig['h3'] = rand($min, $max);
    $tunnelConfig['h4'] = rand($min, $max);

    // Add the new tunnel to the configuration
    $tunnels[] = $tunnelConfig;
    config_set_path($tunnelsPath, $tunnels);
    
    
    // Save the configuration
    write_config("Added new tunnel with name {$tunnelConfig['name']}");

    

    wg_apply_list_add('tunnels', $tunnelData['name']);
    // Resync the package
    wg_resync();
    //$tunnels_to_apply = wg_apply_list_get('tunnels');
    $sync_status = wg_tunnel_sync_by_name( $tunnelConfig['name'], true);
    
    // Handle different return types from wg_tunnel_sync_by_name
    if (is_array($sync_status) && isset($sync_status['ret_code'])) {
        if ($sync_status['ret_code'] !== 0) {
            $error_msg = isset($sync_status['message']) ? $sync_status['message'] : 'Unknown sync error';
            respond(500, '', "Failed to sync tunnel: {$error_msg}");
        }
    } else {
        // If wg_tunnel_sync_by_name doesn't return expected array format, we assume success
        // and continue (this matches the original behavior when it worked)
    }
    
    $tunnelConfig["privatekey"]=""; //Hiding the private key from the response
    
    // Use parseTunnel to ensure consistent formatting including boolean enabled field
    $formattedTunnelConfig = parseTunnel($tunnelConfig);
    respond(200, $formattedTunnelConfig, "Tunnel added successfully");
}

function editTunnel($tunnelData)
{
    global $config;

    $tunnelsPath = AMNEZIAWG_BASE_PATH . '/tunnels/item';
    $tunnels = config_get_path($tunnelsPath, []);

    // Validate required fields
    $requiredFields = ['name', 'descr', 'listenport', 'addresses'];
    foreach ($requiredFields as $field) {
        if (empty($tunnelData[$field])) {
            respond(400, '', "Missing required field: $field");
        }
    }

    // Validate tunnel name format and length
    if (!preg_match('/^[a-zA-Z0-9_-]+$/', $tunnelData['name'])) {
        respond(400, '', "Invalid tunnel name format. Use only alphanumeric characters, hyphens, and underscores.");
    }

    // Linux kernel interface name limit is 15 characters
    if (strlen($tunnelData['name']) > 15) {
        respond(400, '', "Tunnel name exceeds 15 character limit. Current length: " . strlen($tunnelData['name']));
    }

    $found = false;
    foreach ($tunnels as $index => $existingTunnel) {
        if ($existingTunnel['name'] === $tunnelData['name']) {
            $found = true;

            // Preserve keys that should not be overwritten unless provided
            $tunnels[$index]['descr'] = $tunnelData['descr'];
            $tunnels[$index]['listenport'] = $tunnelData['listenport'];
            $tunnels[$index]['addresses'] = ['row' => $tunnelData['addresses']];
            $tunnels[$index]['enabled'] = isset($tunnelData['enabled']) && $tunnelData['enabled'] ? 'yes' : 'no';

            // Optionally update Amnezia-specific fields if provided
            foreach (['jc', 'jmin', 'jmax', 's1', 's2', 'h1', 'h2', 'h3', 'h4'] as $field) {
                if (isset($tunnelData[$field])) {
                    $tunnels[$index][$field] = $tunnelData[$field];
                }
            }

            // Do not allow changing keys or name, do not expose privatekey
            $tunnelConfig = $tunnels[$index];
   

            config_set_path($tunnelsPath, $tunnels);
            write_config("Edited tunnel with name {$tunnelData['name']}");
            wg_apply_list_add('tunnels', $tunnelData['name']);
            $tunnelConfig['privatekey'] = ""; // Hide private key
            wg_resync();
            
            // Use parseTunnel to ensure consistent formatting including boolean enabled field
            $formattedTunnelConfig = parseTunnel($tunnelConfig);
            respond(200, $formattedTunnelConfig, "Tunnel edited successfully");
        }
    }

    if (!$found) {
        respond(404, '', "Tunnel with name {$tunnelData['name']} not found");
    }
}

function syncTunnels($tunnels)
{
    global $config;

    $tunnelsPath = AMNEZIAWG_BASE_PATH . '/tunnels/item';
    $peersPath = AMNEZIAWG_BASE_PATH . '/peers/item';
    
    $existingTunnels = config_get_path($tunnelsPath, []);
    $existingPeers = config_get_path($peersPath, []);

    // Create a map of existing tunnels by name for quick lookup
    $existingTunnelsMap = [];
    foreach ($existingTunnels as $tunnel) {
        $existingTunnelsMap[$tunnel['name']] = $tunnel;
    }

    // Get list of tunnel names that should exist after sync
    $newTunnelNames = array_map(function($tunnel) { return $tunnel['name']; }, $tunnels);
    
    // Find tunnels that need to be deleted (exist but not in new list)
    $tunnelsToDelete = [];
    foreach ($existingTunnels as $tunnel) {
        if (!in_array($tunnel['name'], $newTunnelNames)) {
            $tunnelsToDelete[] = $tunnel['name'];
        }
    }

    // Find new tunnels that need to be brought up (in new list but don't exist)
    $existingTunnelNames = array_map(function($tunnel) { return $tunnel['name']; }, $existingTunnels);
    $tunnelsToAdd = [];
    foreach ($newTunnelNames as $tunnelName) {
        if (!in_array($tunnelName, $existingTunnelNames)) {
            $tunnelsToAdd[] = $tunnelName;
        }
    }

    // First, bring down tunnels that will be deleted using awg-quick
    if (!empty($tunnelsToDelete)) {
        foreach ($tunnelsToDelete as $tunnelName) {
            // Check if tunnel interface exists and is up before trying to bring it down
            if (wg_interface_status($tunnelName)) {
                $cmds = [];
                // Use awg-quick down to properly bring down the tunnel
                $result = wg_ifconfig_if_updown($tunnelName, false, $cmds);
                if (!$result) {
                    error_log("Warning: Failed to bring down tunnel interface '{$tunnelName}' using awg-quick during sync");
                } else {
                    error_log("Successfully brought down tunnel interface '{$tunnelName}' using awg-quick before deletion");
                }
            }
        }
    }

    // Remove peers for deleted tunnels
    if (!empty($tunnelsToDelete)) {
        $filteredPeers = [];
        foreach ($existingPeers as $peer) {
            if (!in_array($peer['tun'], $tunnelsToDelete)) {
                $filteredPeers[] = $peer;
            }
        }
        config_set_path($peersPath, $filteredPeers);
    }

    // Prepare the new list of tunnels
    $newTunnels = [];

    foreach ($tunnels as $tunnel) {
        // Handle both input formats: API format (description, listen_port, address) and internal format (descr, listenport, addresses)
        $name = $tunnel['name'] ?? '';
        $description = $tunnel['description'] ?? $tunnel['descr'] ?? '';
        $listenport = $tunnel['listen_port'] ?? $tunnel['listenport'] ?? '';
        
        // Handle address format conversion
        $addresses = [];
        if (!empty($tunnel['address']) && is_array($tunnel['address'])) {
            // Convert from "IP/MASK" format to internal format
            foreach ($tunnel['address'] as $addr) {
                if (strpos($addr, '/') !== false) {
                    $parts = explode('/', $addr);
                    $addresses[] = ['address' => $parts[0], 'mask' => $parts[1]];
                }
            }
        } elseif (!empty($tunnel['addresses'])) {
            $addresses = $tunnel['addresses'];
        }

        if (empty($name) || empty($description) || empty($listenport) || empty($addresses)) {
            respond(400, '', "Invalid tunnel data: name, description, listen_port, and address are required");
        }

        // Validate tunnel name format and length
        if (!preg_match('/^[a-zA-Z0-9_-]+$/', $name)) {
            respond(400, '', "Invalid tunnel name format for '{$name}'. Use only alphanumeric characters, hyphens, and underscores.");
        }

        // Linux kernel interface name limit is 15 characters
        if (strlen($name) > 15) {
            respond(400, '', "Tunnel name '{$name}' exceeds 15 character limit. Current length: " . strlen($name));
        }

        $existingTunnel = $existingTunnelsMap[$name] ?? null;

        // Generate keypair for new tunnels or preserve existing keys
        if ($existingTunnel) {
            $publickey = $existingTunnel['publickey'];
            $privatekey = $existingTunnel['privatekey'];
        } else {
            $keypair = wg_gen_keypair();
            $publickey = $keypair['pubkey'];
            $privatekey = $keypair['privkey'];
        }

        // Prepare tunnel configuration
        $tunnelConfig = [
            'name' => $name,
            'descr' => $description,
            'publickey' => $publickey,
            'privatekey' => $privatekey,
            'addresses' => [
                'row' => $addresses,
            ],
            'listenport' => $listenport,
            'enabled' => isset($tunnel['enabled']) && $tunnel['enabled'] ? 'yes' : 'no'
        ];

        // Handle Amnezia-specific configuration from config object if provided
        $config_data = $tunnel['config'] ?? [];
        
        if ($existingTunnel) {
            // Preserve existing Amnezia config or use provided values
            $tunnelConfig['jc'] = $config_data['jc'] ?? $existingTunnel['jc'] ?? rand(3, 127);
            $tunnelConfig['jmin'] = $config_data['jmin'] ?? $existingTunnel['jmin'] ?? rand(10, 699);
            $tunnelConfig['jmax'] = $config_data['jmax'] ?? $existingTunnel['jmax'] ?? rand($tunnelConfig['jmin'] + 1, $tunnelConfig['jmin'] + 570);
            $tunnelConfig['s1'] = $config_data['s1'] ?? $existingTunnel['s1'] ?? rand(3, 127);
            $tunnelConfig['s2'] = $config_data['s2'] ?? $existingTunnel['s2'] ?? rand(3, 127);
            $tunnelConfig['h1'] = $config_data['h1'] ?? $existingTunnel['h1'] ?? rand(0x10000011, 0x7FFFFF00);
            $tunnelConfig['h2'] = $config_data['h2'] ?? $existingTunnel['h2'] ?? rand(0x10000011, 0x7FFFFF00);
            $tunnelConfig['h3'] = $config_data['h3'] ?? $existingTunnel['h3'] ?? rand(0x10000011, 0x7FFFFF00);
            $tunnelConfig['h4'] = $config_data['h4'] ?? $existingTunnel['h4'] ?? rand(0x10000011, 0x7FFFFF00);
        } else {
            // Generate default values for new tunnels or use provided config
            $tunnelConfig['jc'] = $config_data['jc'] ?? rand(3, 127);
            $jmin = $config_data['jmin'] ?? rand(10, 699);
            $tunnelConfig['jmin'] = $jmin;
            $tunnelConfig['jmax'] = $config_data['jmax'] ?? rand($jmin + 1, $jmin + 570);
            $tunnelConfig['s1'] = $config_data['s1'] ?? rand(3, 127);
            $tunnelConfig['s2'] = $config_data['s2'] ?? rand(3, 127);
            $tunnelConfig['h1'] = $config_data['h1'] ?? rand(0x10000011, 0x7FFFFF00);
            $tunnelConfig['h2'] = $config_data['h2'] ?? rand(0x10000011, 0x7FFFFF00);
            $tunnelConfig['h3'] = $config_data['h3'] ?? rand(0x10000011, 0x7FFFFF00);
            $tunnelConfig['h4'] = $config_data['h4'] ?? rand(0x10000011, 0x7FFFFF00);
        }

        $newTunnels[] = $tunnelConfig;
    }

    // Replace the tunnels configuration with the updated list
    config_set_path($tunnelsPath, $newTunnels);

    // Save the configuration
    write_config("Synced tunnels - added/updated: " . implode(', ', $newTunnelNames) . 
                 (!empty($tunnelsToDelete) ? ", deleted: " . implode(', ', $tunnelsToDelete) : ""));

    // Add all tunnels to apply list
    foreach ($newTunnelNames as $tunnelName) {
        wg_apply_list_add('tunnels', $tunnelName);
    }

    // Add all tunnels to apply list
    foreach ($newTunnelNames as $tunnelName) {
        wg_apply_list_add('tunnels', $tunnelName);
    }

    

    wg_apply_list_add('tunnels', $tunnelData['name']);
    // Resync the package
    wg_resync();

    // Bring up new tunnels that were added during sync (using same approach as addTunnel)
    if (!empty($tunnelsToAdd)) {
        foreach ($tunnelsToAdd as $tunnelName) {
            // Check if the tunnel should be enabled
            $tunnelShouldBeEnabled = false;
            foreach ($tunnels as $tunnel) {
                if ($tunnel['name'] === $tunnelName && (!isset($tunnel['enabled']) || $tunnel['enabled'])) {
                    $tunnelShouldBeEnabled = true;
                    break;
                }
            }
            
            if ($tunnelShouldBeEnabled) {
                // Use the same method as addTunnel: wg_tunnel_sync_by_name
                $sync_status = wg_tunnel_sync_by_name($tunnelName, true);
                
                // Handle different return types from wg_tunnel_sync_by_name
                if (is_array($sync_status) && isset($sync_status['ret_code'])) {
                    if ($sync_status['ret_code'] !== 0) {
                        $error_msg = isset($sync_status['message']) ? $sync_status['message'] : 'Unknown error';
                        error_log("Warning: Failed to bring up new tunnel interface '{$tunnelName}' during sync. Error code: {$sync_status['ret_code']}, Message: {$error_msg}");
                    } else {
                        error_log("Successfully brought up new tunnel interface '{$tunnelName}' using wg_tunnel_sync_by_name");
                    }
                } else {
                    // Handle case where wg_tunnel_sync_by_name returns non-array or unexpected format
                    error_log("Successfully called wg_tunnel_sync_by_name for new tunnel interface '{$tunnelName}' (return type: " . gettype($sync_status) . ")");
                }
            }
        }
    }

    $responseMessage = "Tunnels synced successfully";
    if (!empty($tunnelsToDelete)) {
        $responseMessage .= " (deleted tunnels: " . implode(', ', $tunnelsToDelete) . ")";
    }
    if (!empty($tunnelsToAdd)) {
        $responseMessage .= " (added tunnels: " . implode(', ', $tunnelsToAdd) . ")";
    }

    respond(200, listTunnels(), $responseMessage);
}

function resetTunnelConfig($tunnelName)
{
    global $config;

    $tunnelsPath = AMNEZIAWG_BASE_PATH . '/tunnels/item';
    $existingTunnels = config_get_path($tunnelsPath, []);

    if (empty($existingTunnels)) {
        respond(400, '', "No tunnels found to reset");
    }

    // Validate tunnel name is provided
    if (empty($tunnelName) || !is_string($tunnelName)) {
        respond(400, '', "Tunnel name is required and must be a string");
    }

    // Validate tunnel exists
    $tunnelExists = false;
    $tunnelConfig = null;
    foreach ($existingTunnels as $tunnel) {
        if ($tunnel['name'] === $tunnelName) {
            $tunnelExists = true;
            $tunnelConfig = $tunnel;
            break;
        }
    }

    if (!$tunnelExists) {
        respond(404, '', "Tunnel '{$tunnelName}' not found");
    }

    // Step 1: Bring down the tunnel if it's running
    if (wg_interface_status($tunnelName)) {
        $cmds = [];
        $result = wg_ifconfig_if_updown($tunnelName, false, $cmds);
        if (!$result) {
            error_log("Warning: Failed to bring down tunnel '{$tunnelName}' during reset");
        } else {
            error_log("Successfully brought down tunnel '{$tunnelName}' for reset");
        }
    }

    // Step 2: Generate new Amnezia WireGuard configuration values
    $tunnelsPath = AMNEZIAWG_BASE_PATH . '/tunnels/item';
    $tunnels = config_get_path($tunnelsPath, []);
    
    // Find and update the tunnel with new Amnezia config values
    foreach ($tunnels as $index => $tunnel) {
        if ($tunnel['name'] === $tunnelName) {
            // Generate fresh Amnezia WireGuard obfuscation parameters
            $tunnels[$index]['jc'] = rand(3, 10);
            $jmin = rand(10, 300);
            $tunnels[$index]['jmin'] = $jmin;
            $tunnels[$index]['jmax'] = rand($jmin + 1, $jmin + 570);
            $tunnels[$index]['s1'] = rand(3, 127);
            $tunnels[$index]['s2'] = rand(3, 127);
            
            $min = 0x10000011;
            $max = 0x7FFFFF00;
            $tunnels[$index]['h1'] = rand($min, $max);
            $tunnels[$index]['h2'] = rand($min, $max);
            $tunnels[$index]['h3'] = rand($min, $max);
            $tunnels[$index]['h4'] = rand($min, $max);
            
            // Update the tunnel configuration
            $tunnelConfig = $tunnels[$index];
            break;
        }
    }
    
    // Save the updated configuration with new Amnezia parameters
    config_set_path($tunnelsPath, $tunnels);
    write_config("Reset tunnel '{$tunnelName}' with new Amnezia configuration parameters");

    // Step 3: Resync configurations to regenerate config files with new parameters
    wg_resync();

    // Step 4: Bring up the tunnel with fresh configuration if it should be enabled
    $shouldBeEnabled = (!isset($tunnelConfig['enabled']) || $tunnelConfig['enabled'] === 'yes');

    if ($shouldBeEnabled) {
        // Use the same method as addTunnel: wg_tunnel_sync_by_name
        $sync_status = wg_tunnel_sync_by_name($tunnelName, true);
        
        // Handle different return types from wg_tunnel_sync_by_name
        if (is_array($sync_status) && isset($sync_status['ret_code'])) {
            if ($sync_status['ret_code'] !== 0) {
                $error_msg = isset($sync_status['message']) ? $sync_status['message'] : 'Unknown error';
                error_log("Warning: Failed to bring up tunnel '{$tunnelName}' during reset. Error code: {$sync_status['ret_code']}, Message: {$error_msg}");
                respond(500, '', "Failed to restart tunnel '{$tunnelName}': {$error_msg}");
            } else {
                error_log("Successfully reset and brought up tunnel '{$tunnelName}' with new Amnezia configuration");
            }
        } else {
            // If wg_tunnel_sync_by_name doesn't return expected array format, assume success
            error_log("Successfully called wg_tunnel_sync_by_name for tunnel '{$tunnelName}' with new Amnezia configuration (return type: " . gettype($sync_status) . ")");
        }
        
        $responseMessage = "Tunnel '{$tunnelName}' configuration reset with new Amnezia parameters and restarted successfully";
    } else {
        // Tunnel is disabled, just note it was processed
        error_log("Tunnel '{$tunnelName}' is disabled, configuration reset with new Amnezia parameters but not started");
        $responseMessage = "Tunnel '{$tunnelName}' configuration reset with new Amnezia parameters (tunnel is disabled)";
    }

    // Return only the specific tunnel that was reset, not all tunnels
    $resetTunnelData = parseTunnel($tunnelConfig);
    respond(200, $resetTunnelData, $responseMessage);
}

$uri = $_SERVER['REQUEST_URI'];
$apiKey = $_SERVER['HTTP_X_API_KEY'] ?? '';
$iface = $_SERVER['X-INTERFACE-NAME'] ?? '';

authenticate($apiKey);

// BUG FIX: Handle cases where no JSON input is provided
$input = getJsonInputData();

// BUG FIX: Check if input is valid before processing
if (!empty($input) && is_array($input)) {
    $action = $input['act'] ?? '';
    
    // BUG FIX: Validate action parameter
    if (empty($action) || !is_string($action)) {
        respond(400, '', "Invalid or missing action parameter");
    }
    
    switch ($action) {
        case "get_peers":
            respond(200, listPeers());
            break;
        case "get_tunnels":
            respond(200, listTunnels());
            break;
        case "get_connected_peers":
            respond(200, getConnectedPeers());
            break;
        case "sync_peers":
            $peers = $input['peers'] ?? [];
            $tunnel = $input['tunnel'] ?? 'all'; // Default to 'all' if not specified

            if (!is_array($peers)) {
                respond(400, '', "Peers must be an array");
            }

            // Allow syncing to all tunnels or a specific tunnel
            // If tunnel is 'all' or empty, sync to all tunnels
            // Empty array is allowed to clear all peers
            syncPeers($peers, $tunnel);
            break;
        case "sync_peers_all":
            $peers = $input['peers'] ?? [];

            if (!is_array($peers)) {
                respond(400, '', "Invalid or missing peers data");
            }

            // Explicitly sync to all tunnels
            syncPeers($peers, 'all');
            break;
        case "sync_tunnels":
            $tunnels = $input['tunnels'] ?? [];

            if (empty($tunnels) || !is_array($tunnels)) {
                respond(400, '', "Invalid or missing tunnels data");
            }

            syncTunnels($tunnels);
            break;
        case "add_tunnel":
            $tunnelData = $input['tunnel'] ?? [];
            $overwrite = $input['overwrite'] ?? false;
            
            if (empty($tunnelData)) {
                respond(400, '', "Invalid or missing tunnel data");
            }
            addTunnel($tunnelData, $overwrite);
            break;
        case "reset_tunnel":
            $tunnelName = $input['tunnel'] ?? '';
            
            // Validate tunnel parameter
            if (empty($tunnelName) || !is_string($tunnelName)) {
                respond(400, '', "Invalid tunnel parameter: tunnel name is required and must be a string");
            }
            
            resetTunnelConfig($tunnelName);
            break;
    
        default:
            respond(400, '', "Invalid action specified: " . htmlspecialchars($action));
    }
} else {
    respond(400, '', "Invalid or missing JSON input");
}


?>