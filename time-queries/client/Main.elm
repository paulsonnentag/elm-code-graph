module Main exposing (..)

import Html exposing (..)
import Html.Attributes exposing (class, cols, rows, value, disabled, style, checked, type_)
import Html.Events exposing (onInput, onClick)
import LineChart
import LineChart.Dots as Dots
import LineChart as LineChart
import LineChart.Junk as Junk
import LineChart.Dots as Dots
import LineChart.Container as Container
import LineChart.Interpolation as Interpolation
import LineChart.Axis.Intersection as Intersection
import LineChart.Axis as Axis
import LineChart.Legends as Legends
import LineChart.Line as Line
import LineChart.Events as Events
import LineChart.Grid as Grid
import LineChart.Legends as Legends
import LineChart.Area as Area
import Color
import Dict exposing (Dict)
import Http
import Json.Decode as Decode


main : Program Never Model Msg
main =
    Html.program
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        }



--- MODEL


type alias Model =
    { loading : Bool
    , query : String
    , isStacked : Bool
    , result : Maybe (Result Http.Error GraphData)
    }


type alias GraphData =
    Dict String (List Float)


init : ( Model, Cmd Msg )
init =
    let
        query =
            "MATCH (r:Repo) \nWHERE r.lastUpdated <= $timestamp AND r.created >= $timestamp \nRETURN count(r) as value, 'activeRepos' as label"
    in
        ( { loading = False
          , query = query
          , result = Nothing
          , isStacked = False
          }
        , Http.send LoadResult (queryRequest query)
        )


queryRequest : String -> Http.Request GraphData
queryRequest query =
    Http.get ("http://localhost:3000?q=" ++ (Http.encodeUri query)) decodeData


decodeData : Decode.Decoder GraphData
decodeData =
    Decode.dict (Decode.list Decode.float)



-- UPDATE


type Msg
    = LoadResult (Result Http.Error GraphData)
    | UpdateQuery String
    | RunQuery
    | ToggleIsStacked


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        LoadResult result ->
            ( { model | loading = False, result = Just result }, Cmd.none )

        UpdateQuery query ->
            ( { model | query = query }, Cmd.none )

        RunQuery ->
            ( { model | loading = True, result = Nothing }, Http.send LoadResult (queryRequest model.query) )

        ToggleIsStacked ->
            ( { model | isStacked = not model.isStacked }, Cmd.none )



-- VIEW


type alias StyleProps =
    List ( String, String )


boxSizingStyle : StyleProps
boxSizingStyle =
    [ ( "box-sizing", "border-box" ) ]


appStyle : StyleProps
appStyle =
    boxSizingStyle
        ++ [ ( "background-color", "rgb(210,213,218)" )
           , ( "height", "100%" )
           , ( "width", "100%" )
           , ( "padding", "20px" )
           ]


queryBoxStyle : StyleProps
queryBoxStyle =
    boxSizingStyle
        ++ [ ( "padding", "12px" )
           , ( "margin-bottom", "10px" )
           , ( "background", "rgb(239, 239, 244)" )
           , ( "box-shadow", "rgba(0, 0, 0, 0.1) 0px 1px 4px" )
           , ( "display", "flex" )
           , ( "flex-direction", "row" )
           , ( "align-items", "center" )
           ]


textAreaStyle : StyleProps
textAreaStyle =
    boxSizingStyle
        ++ [ ( "border-radius", "5px" )
           , ( "border", "0" )
           , ( "outline", "0" )
           , ( "width", "100%" )
           ]


buttonStyle : StyleProps
buttonStyle =
    boxSizingStyle
        ++ [ ( "width", "50px" )
           , ( "height", "50px" )
           , ( "margin-left", "10px" )
           , ( "background", "transparent" )
           , ( "border", "0" )
           , ( "background-image", "url('assets/run.svg')" )
           , ( "background-size", "contain" )
           , ( "background-position", "center" )
           , ( "background-repeat", "no-repeat" )
           ]


graphStyle : StyleProps
graphStyle =
    boxSizingStyle
        ++ [ ( "box-shadow", "rgba(0, 0, 0, 0.1) 0px 1px 4px" )
           , ( "background", "white" )
           ]


errorStyle : StyleProps
errorStyle =
    boxSizingStyle ++ [ ( "padding", "10px" ) ]


view : Model -> Html Msg
view { loading, query, result, isStacked } =
    div [ style appStyle ]
        [ div
            [ style queryBoxStyle ]
            [ textarea
                [ rows 4
                , value query
                , onInput UpdateQuery
                , disabled loading
                , style textAreaStyle
                ]
                []
            , button
                [ onClick RunQuery
                , disabled loading
                , style buttonStyle
                ]
                [ text "" ]
            ]
        , div [ style graphStyle ]
            [ case result of
                Nothing ->
                    text ""

                Just result ->
                    case result of
                        Ok sequences ->
                            div
                                []
                                [ label []
                                    [ input
                                        [ type_ "checkbox"
                                        , onClick ToggleIsStacked
                                        , checked isStacked
                                        ]
                                        []
                                    , text "stack lines"
                                    ]
                                , chart isStacked sequences
                                ]

                        Err message ->
                            pre [ style errorStyle ]
                                [ text ("Error: " ++ (toString message)) ]
            ]
        ]


chart : Bool -> GraphData -> Html.Html msg
chart isStacked graph =
    LineChart.viewCustom
        { x = Axis.default 700 "time" (\( key, value ) -> toFloat key)
        , y = Axis.default 450 "" (\( key, value ) -> value)
        , container = Container.styled "line-chart-1" [ ( "font-family", "monospace" ) ]
        , interpolation = Interpolation.monotone
        , intersection = Intersection.default
        , legends = Legends.default
        , events = Events.default
        , junk = Junk.default
        , grid = Grid.default
        , area =
            if isStacked then
                Area.stacked 0.5
            else
                Area.default
        , line = Line.default
        , dots = Dots.custom (Dots.empty 5 1)
        }
        (graph
            |> Dict.toList
            |> List.indexedMap graphSequenceToLine
        )


graphSequenceToLine : Int -> ( String, List Float ) -> LineChart.Series ( Int, Float )
graphSequenceToLine index ( label, values ) =
    let
        color =
            case index % 5 of
                0 ->
                    Color.red

                1 ->
                    Color.green

                2 ->
                    Color.blue

                3 ->
                    Color.yellow

                _ ->
                    Color.orange

        dots =
            case (index // 5) % 7 of
                0 ->
                    Dots.none

                1 ->
                    Dots.circle

                2 ->
                    Dots.triangle

                3 ->
                    Dots.square

                4 ->
                    Dots.diamond

                5 ->
                    Dots.plus

                _ ->
                    Dots.cross
    in
        LineChart.line color Dots.none label (List.indexedMap (,) values)



-- SUBSCRIPTIONS


subscriptions : Model -> Sub Msg
subscriptions model =
    Sub.none
