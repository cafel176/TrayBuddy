use traybuddy_lib::modules::environment::{
    get_season_by_month_and_latitude, Season,
};

#[test]
fn season_names_and_hemisphere_rules_hold() {
    assert_eq!(Season::Spring.name(), "spring");
    assert_eq!(Season::Winter.name_zh(), "冬");

    assert_eq!(get_season_by_month_and_latitude(4, 30.0), Season::Spring);
    assert_eq!(get_season_by_month_and_latitude(4, -30.0), Season::Autumn);
    assert_eq!(get_season_by_month_and_latitude(12, 40.0), Season::Winter);
    assert_eq!(get_season_by_month_and_latitude(12, -40.0), Season::Summer);
}
